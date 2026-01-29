// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Flex,
  Paper,
  Group,
  Button,
  Divider,
  ActionIcon,
  ScrollArea,
  Stack,
  Skeleton,
  Text,
  Box,
} from '@mantine/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { ServiceRequest } from '@medplum/fhirtypes';
import { getReferenceString } from '@medplum/core';
import { useNavigate, useParams } from 'react-router';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { showErrorNotification } from '../../utils/notifications';
import { IconPlus, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import { ReferralListItem } from '../../components/referrals/ReferralListItem';
import { ReferralDetails } from '../../components/referrals/ReferralDetails';
import { CreateReferralModal } from '../../components/referrals/CreateReferralModal';
import cx from 'clsx';
import classes from './ReferralsPage.module.css';

type ReferralTab = 'active' | 'completed' | 'all';

export function ReferralsPage(): JSX.Element {
  const { serviceRequestId } = useParams();
  const navigate = useNavigate();
  const medplum = useMedplum();
  const profile = useMedplumProfile();

  const [activeTab, setActiveTab] = useState<ReferralTab>('active');
  const [activeReferrals, setActiveReferrals] = useState<ServiceRequest[]>([]);
  const [completedReferrals, setCompletedReferrals] = useState<ServiceRequest[]>([]);
  const [allReferrals, setAllReferrals] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [createModalOpened, setCreateModalOpened] = useState<boolean>(false);
  const [currentReferral, setCurrentReferral] = useState<ServiceRequest>();
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  const profileReference = useMemo(() => (profile ? getReferenceString(profile) : undefined), [profile]);

  const fetchReferrals = useCallback(async (): Promise<void> => {
    try {
      // Search for all ServiceRequests
      const searchParams = new URLSearchParams({
        _count: '100',
        _sort: '-_lastUpdated',
        _fields:
          '_lastUpdated,code,status,priority,category,subject,requester,performer,reasonCode,note,authoredOn,occurrenceDateTime',
      });

      const results: ServiceRequest[] = await medplum.searchResources('ServiceRequest', searchParams, {
        cache: 'no-cache',
      });

      // Filter into categories
      const active = results.filter(
        (r) => r.status === 'active' || r.status === 'draft' || r.status === 'on-hold'
      );
      const completed = results.filter((r) => r.status === 'completed');

      setActiveReferrals(active);
      setCompletedReferrals(completed);
      setAllReferrals(results);
    } catch (error) {
      showErrorNotification(error);
    }
  }, [medplum]);

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      await fetchReferrals();
    } finally {
      setLoading(false);
    }
  }, [fetchReferrals]);

  useEffect(() => {
    fetchData().catch(showErrorNotification);
  }, [fetchData]);

  const handleReferralSelect = useCallback(
    (referral: ServiceRequest): string => {
      return `/referrals/${referral.id}`;
    },
    []
  );

  useEffect(() => {
    const fetchReferral = async (): Promise<void> => {
      if (serviceRequestId) {
        const currentItems =
          activeTab === 'active' ? activeReferrals : activeTab === 'completed' ? completedReferrals : allReferrals;
        const referral = currentItems.find((r: ServiceRequest) => r.id === serviceRequestId);

        if (referral) {
          setCurrentReferral(referral);
        } else {
          const referral = await medplum.readResource('ServiceRequest', serviceRequestId);
          if (referral) {
            setCurrentReferral(referral);
          }
        }
      } else {
        setCurrentReferral(undefined);
      }
    };
    fetchReferral().catch(showErrorNotification);
  }, [activeTab, activeReferrals, completedReferrals, allReferrals, serviceRequestId, medplum]);

  const handleTabChange = (value: ReferralTab): void => {
    setActiveTab(value);
  };

  const handleReferralCreated = (): void => {
    setCreateModalOpened(false);
    fetchData()
      .then(() => {
        setActiveTab('active');
        navigate('/referrals')?.catch(console.error);
      })
      .catch(showErrorNotification);
  };

  const handleReferralUpdated = (): void => {
    fetchData().catch(showErrorNotification);
  };

  const currentItems =
    activeTab === 'active' ? activeReferrals : activeTab === 'completed' ? completedReferrals : allReferrals;

  return (
    <Flex h="100%">
      {/* Left sidebar - Referral list */}
      <Box
        className={classes.sidebar}
        style={{
          width: sidebarOpen ? 350 : 0,
          opacity: sidebarOpen ? 1 : 0,
        }}
      >
        <Flex direction="column" h="100%">
          <Paper className={classes.sidebarHeader}>
            <Flex h={64} align="center" justify="space-between" p="md">
              <Group gap="xs">
                <Button
                  className={cx(classes.button, { [classes.selected]: activeTab === 'active' })}
                  h={32}
                  radius="xl"
                  onClick={() => handleTabChange('active')}
                >
                  Active
                </Button>

                <Button
                  className={cx(classes.button, { [classes.selected]: activeTab === 'completed' })}
                  h={32}
                  radius="xl"
                  onClick={() => handleTabChange('completed')}
                >
                  Completed
                </Button>

                <Button
                  className={cx(classes.button, { [classes.selected]: activeTab === 'all' })}
                  h={32}
                  radius="xl"
                  onClick={() => handleTabChange('all')}
                >
                  All
                </Button>
              </Group>

              <Group gap="xs">
                <ActionIcon radius="50%" variant="filled" color="blue" onClick={() => setCreateModalOpened(true)}>
                  <IconPlus size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" onClick={() => setSidebarOpen(false)}>
                  <IconLayoutSidebarLeftCollapse size={18} />
                </ActionIcon>
              </Group>
            </Flex>
          </Paper>

          <Divider />
          <Paper style={{ flex: 1, overflow: 'hidden' }}>
            <ScrollArea h="100%" p="0.5rem">
              {loading && <ReferralListSkeleton />}
              {!loading && currentItems.length === 0 && <EmptyReferralsState activeTab={activeTab} />}
              {!loading &&
                currentItems.length > 0 &&
                currentItems.map((item, index) => {
                  return (
                    <React.Fragment key={item.id}>
                      <ReferralListItem
                        item={item}
                        selectedItem={currentReferral}
                        onItemSelect={handleReferralSelect}
                      />
                      {index < currentItems.length - 1 && (
                        <Box px="0.5rem">
                          <Divider />
                        </Box>
                      )}
                    </React.Fragment>
                  );
                })}
            </ScrollArea>
          </Paper>
        </Flex>
      </Box>

      {/* Main content area - Referral details */}
      <Box className={classes.mainContent}>
        <Box className={classes.contentHeader}>
          {!sidebarOpen && (
            <ActionIcon variant="subtle" color="gray" onClick={() => setSidebarOpen(true)}>
              <IconLayoutSidebarLeftExpand size={18} />
            </ActionIcon>
          )}
        </Box>
        <Box style={{ flex: 1, overflow: 'hidden' }}>
          {currentReferral ? (
            <ReferralDetails referral={currentReferral} onUpdate={handleReferralUpdated} />
          ) : (
            <EmptySelectionState />
          )}
        </Box>
      </Box>

      {/* Create Referral Modal */}
      <CreateReferralModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        onCreated={handleReferralCreated}
      />
    </Flex>
  );
}

function EmptyReferralsState({ activeTab }: { activeTab: ReferralTab }): JSX.Element {
  return (
    <Flex direction="column" h="100%" justify="center" align="center">
      <Stack align="center" gap="md" pt="xl">
        <Text size="md" c="dimmed" fw={400}>
          No {activeTab} referrals to display.
        </Text>
      </Stack>
    </Flex>
  );
}

function EmptySelectionState(): JSX.Element {
  return (
    <Flex direction="column" h="100%" justify="center" align="center">
      <Stack align="center" gap="md">
        <Text size="md" c="dimmed" fw={400}>
          Select a referral to view details
        </Text>
      </Stack>
    </Flex>
  );
}

function ReferralListSkeleton(): JSX.Element {
  return (
    <Stack gap="md" p="md">
      {Array.from({ length: 6 }).map((_, index) => (
        <Stack key={index}>
          <Flex direction="column" gap="xs" align="flex-start">
            <Skeleton height={16} width={`${Math.random() * 40 + 60}%`} />
            <Skeleton height={14} width={`${Math.random() * 50 + 40}%`} />
            <Skeleton height={14} width={`${Math.random() * 50 + 40}%`} />
          </Flex>
          <Divider />
        </Stack>
      ))}
    </Stack>
  );
}
