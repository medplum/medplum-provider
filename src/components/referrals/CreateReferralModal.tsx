// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Modal,
  Stack,
  Button,
  Group,
  Select,
  Textarea,
  Input,
} from '@mantine/core';
import type { Patient, Practitioner, CodeableConcept, ServiceRequest } from '@medplum/fhirtypes';
import { ResourceInput, useMedplum, ValueSetAutocomplete, DateTimeInput } from '@medplum/react';
import { createReference } from '@medplum/core';
import { useState } from 'react';
import type { JSX } from 'react';
import { showNotification } from '@mantine/notifications';
import { showErrorNotification } from '../../utils/notifications';

interface CreateReferralModalProps {
  opened: boolean;
  onClose: () => void;
  defaultPatient?: Patient;
  onCreated?: () => void;
}

export function CreateReferralModal({
  opened,
  onClose,
  defaultPatient,
  onCreated,
}: CreateReferralModalProps): JSX.Element {
  const medplum = useMedplum();

  const [patient, setPatient] = useState<Patient | undefined>(defaultPatient);
  const [requester, setRequester] = useState<Practitioner | undefined>(medplum.getProfile() as Practitioner);
  const [performer, setPerformer] = useState<Practitioner | undefined>();
  const [specialty, setSpecialty] = useState<CodeableConcept | undefined>();
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'asap' | 'stat'>('routine');
  const [reasonCodes, setReasonCodes] = useState<CodeableConcept[]>([]);
  const [notes, setNotes] = useState('');
  const [occurrenceDateTime, setOccurrenceDateTime] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    if (!patient || !requester || !specialty) {
      return;
    }

    setIsSubmitting(true);
    try {
      const serviceRequest: ServiceRequest = {
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        priority,
        code: specialty,
        subject: createReference(patient),
        requester: createReference(requester),
        authoredOn: new Date().toISOString(),
        category: [
          {
            coding: [
              {
                system: 'http://snomed.info/sct',
                code: '3457005',
                display: 'Referral',
              },
            ],
          },
        ],
        ...(reasonCodes.length > 0 && { reasonCode: reasonCodes }),
        ...(notes && { note: [{ text: notes }] }),
        ...(occurrenceDateTime && { occurrenceDateTime }),
        ...(performer && { performer: [createReference(performer)] }),
      };

      await medplum.createResource(serviceRequest);

      showNotification({
        title: 'Referral Created',
        message: 'Successfully created new referral.',
        color: 'green',
      });

      // Reset form
      setPatient(defaultPatient);
      setPerformer(undefined);
      setSpecialty(undefined);
      setPriority('routine');
      setReasonCodes([]);
      setNotes('');
      setOccurrenceDateTime(undefined);

      onClose();
      if (onCreated) {
        onCreated();
      }
    } catch (error) {
      showErrorNotification(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = (): void => {
    if (!isSubmitting) {
      onClose();
    }
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Create Referral" size="lg" centered>
      <Stack gap="md">
        <Input.Wrapper label="Patient" required>
          <ResourceInput<Patient>
            resourceType="Patient"
            name="patient"
            defaultValue={patient}
            onChange={setPatient}
          />
        </Input.Wrapper>

        <Input.Wrapper label="Referring Provider" required>
          <ResourceInput<Practitioner>
            resourceType="Practitioner"
            name="requester"
            defaultValue={requester}
            onChange={setRequester}
          />
        </Input.Wrapper>

        <Input.Wrapper label="Refer To (Provider)">
          <ResourceInput<Practitioner>
            resourceType="Practitioner"
            name="performer"
            defaultValue={performer}
            onChange={setPerformer}
          />
        </Input.Wrapper>

        <ValueSetAutocomplete
          label="Specialty / Service"
          required
          binding="http://hl7.org/fhir/ValueSet/c80-practice-codes"
          name="specialty"
          onChange={(items) => {
            if (items.length > 0) {
              setSpecialty({ coding: [items[0]] });
            } else {
              setSpecialty(undefined);
            }
          }}
        />

        <Select
          label="Priority"
          value={priority}
          onChange={(value) => setPriority(value as typeof priority)}
          data={[
            { value: 'routine', label: 'Routine' },
            { value: 'urgent', label: 'Urgent' },
            { value: 'asap', label: 'ASAP' },
            { value: 'stat', label: 'STAT' },
          ]}
        />

        <ValueSetAutocomplete
          label="Reason for Referral"
          binding="http://hl7.org/fhir/sid/icd-10-cm"
          name="reasonCodes"
          maxValues={5}
          onChange={(items) => {
            setReasonCodes(items.map((item) => ({ coding: [item] })));
          }}
        />

        <DateTimeInput
          label="Scheduled Date/Time"
          name="occurrenceDateTime"
          onChange={(value) => setOccurrenceDateTime(value || undefined)}
        />

        <Textarea
          label="Notes"
          placeholder="Additional information about this referral..."
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          rows={4}
        />

        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={!patient || !requester || !specialty}
          >
            Create Referral
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
