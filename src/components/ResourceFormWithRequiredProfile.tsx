// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert } from '@mantine/core';
import { addProfileToResource, normalizeErrorString, tryGetProfile } from '@medplum/core';
import type { InternalTypeSchema } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';
import { Loading, ResourceForm, useMedplum } from '@medplum/react';
import type { ResourceFormProps } from '@medplum/react';
import { IconAlertCircle } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';

interface ResourceFormWithRequiredProfileProps extends ResourceFormProps {
  /** (optional) If specified, an error is shown in place of `ResourceForm` if the profile cannot be loaded.  */
  readonly profileUrl?: string; // Also part of ResourceFormProps, but list here incase its type changes in the future
  /** (optiona) A short error message to show if `profileUrl` cannot be found. */
  readonly missingProfileMessage?: ReactNode;
}

export function ResourceFormWithRequiredProfile(props: ResourceFormWithRequiredProfileProps): JSX.Element {
  const { missingProfileMessage, onSubmit, ...resourceFormProps } = props;
  const profileUrl = props.profileUrl;

  const medplum = useMedplum();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<any>();
  const [profile, setProfile] = useState<InternalTypeSchema>();

  useEffect(() => {
    if (!profileUrl) {
      setLoadingProfile(false);
      return;
    }

    // First try to get the profile from the Medplum server
    medplum
      .requestProfileSchema(profileUrl, { expandProfile: true })
      .then(() => {
        const resourceProfile = tryGetProfile(profileUrl);
        if (resourceProfile) {
          setProfile(resourceProfile);
          setLoadingProfile(false);
        } else {
          // If not found, try to fetch from HL7 registry and upload it
          fetchAndUploadProfile(profileUrl);
        }
      })
      .catch((reason) => {
        // If request fails, try to fetch from HL7 registry
        console.warn('Profile not found in Medplum project, attempting to fetch from HL7 registry:', reason);
        fetchAndUploadProfile(profileUrl);
      });

    async function fetchAndUploadProfile(url: string): Promise<void> {
      try {
        // Convert HL7 profile URL to build.fhir.org format
        // http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient
        // -> https://build.fhir.org/ig/HL7/US-Core/StructureDefinition-us-core-patient.json
        let hl7Url: string;
        if (url.includes('http://hl7.org/fhir/us/core/StructureDefinition/')) {
          const profileName = url.split('/').pop();
          hl7Url = `https://build.fhir.org/ig/HL7/US-Core/StructureDefinition-${profileName}.json`;
        } else {
          // Try other HL7 registry endpoints
          hl7Url = url.replace('http://', 'https://') + '.json';
        }
        
        const response = await fetch(hl7Url);
        
        if (response.ok) {
          const structureDefinition = await response.json();
          // Upload the profile to Medplum
          await medplum.createResource(structureDefinition);
          // Now request it again
          await medplum.requestProfileSchema(url, { expandProfile: true });
          const resourceProfile = tryGetProfile(url);
          if (resourceProfile) {
            setProfile(resourceProfile);
          }
        } else {
          throw new Error(`Failed to fetch profile from HL7 registry: ${response.statusText}`);
        }
      } catch (error) {
        console.error('Failed to fetch and upload profile:', error);
        setProfileError(error);
      } finally {
        setLoadingProfile(false);
      }
    }
  }, [medplum, profileUrl]);

  const handleSubmit = useCallback(
    (newResource: Resource): void => {
      if (!onSubmit) {
        return;
      }
      if (profileUrl) {
        addProfileToResource(newResource, profileUrl);
      }
      onSubmit(newResource);
    },
    [onSubmit, profileUrl]
  );

  if (profileUrl && loadingProfile) {
    return <Loading />;
  }

  if (profileUrl && !profile) {
    const errorContent = (
      <>
        {missingProfileMessage && <p>{missingProfileMessage}</p>}
        {profileError && <p>Server error: {normalizeErrorString(profileError)}</p>}
      </>
    );

    return (
      <Alert icon={<IconAlertCircle size={16} />} title="Not found" color="red">
        {errorContent}
      </Alert>
    );
  }

  return <ResourceForm onSubmit={handleSubmit} {...resourceFormProps} />;
}
