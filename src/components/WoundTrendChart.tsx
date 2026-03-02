import { Card, Text, Title } from '@mantine/core';
import type { Observation } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface WoundTrendChartProps {
  patientId: string;
}

interface DataPoint {
  date: string;
  surfaceArea: number;
}

export function WoundTrendChart({ patientId }: WoundTrendChartProps): JSX.Element {
  const medplum = useMedplum();
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      // Query wound surface area observations (LOINC 72298-3)
      const observations = await medplum.searchResources(
        'Observation',
        `subject=Patient/${patientId}&code=72298-3&_sort=date`
      );

      const points: DataPoint[] = observations
        .filter((obs: Observation) => obs.valueQuantity?.value !== undefined)
        .map((obs: Observation) => ({
          date: obs.effectiveDateTime
            ? new Date(obs.effectiveDateTime).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
            : '',
          surfaceArea: obs.valueQuantity?.value || 0,
        }));

      setData(points);
    } finally {
      setLoading(false);
    }
  }, [medplum, patientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <Card withBorder shadow="sm"><Text c="dimmed">Loading wound trend...</Text></Card>;
  }

  if (data.length === 0) {
    return (
      <Card withBorder shadow="sm" p="xl">
        <Text ta="center" c="dimmed">No wound measurements recorded yet.</Text>
      </Card>
    );
  }

  return (
    <Card withBorder shadow="sm" p="md">
      <Title order={4} mb="md">Wound Surface Area Trend</Title>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis
            label={{ value: 'Surface Area (cm²)', angle: -90, position: 'insideLeft' }}
            domain={[0, 'auto']}
          />
          <Tooltip
            formatter={(value: number | string | undefined) => [`${Number(value ?? 0).toFixed(2)} cm²`, 'Surface Area']}
          />
          <Legend />
          <ReferenceLine
            y={0}
            stroke="green"
            strokeDasharray="5 5"
            label={{ value: 'Goal: 0 cm²', fill: 'green', fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="surfaceArea"
            stroke="#0b435a"
            strokeWidth={2}
            dot={{ r: 5 }}
            activeDot={{ r: 7 }}
            name="Surface Area"
          />
        </LineChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" ta="center" mt="sm">
        Wound surface area reduction across visits (LOINC 72298-3)
      </Text>
    </Card>
  );
}
