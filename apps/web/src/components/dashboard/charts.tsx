"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { reviewTrend, type EvalRun } from "@/lib/dashboard-data";

const axisStyle = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };

export function ReviewTrendChart(): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={reviewTrend} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
        <defs>
          <linearGradient id="findingsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="day" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            borderColor: "hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--foreground))"
          }}
        />
        <Area
          type="monotone"
          dataKey="findings"
          name="Findings posted"
          stroke="hsl(var(--primary))"
          fill="url(#findingsGradient)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="rejected"
          name="Rejected candidates"
          stroke="hsl(var(--muted-foreground))"
          fill="transparent"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CostLatencyChart(): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={reviewTrend} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="day" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            borderColor: "hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--foreground))"
          }}
        />
        <Legend />
        <Bar dataKey="cost" name="Cost USD" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        <Bar
          dataKey="latency"
          name="Latency seconds"
          fill="hsl(var(--muted-foreground))"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EvalQualityChart({ evals }: { evals: EvalRun[] }): React.ReactElement {
  const data = [...evals].reverse().map((item) => ({
    name: item.name.replace("-v", " v"),
    precision: Math.round(item.precision * 100),
    recall: Math.round(item.recall * 100)
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} domain={[60, 100]} />
        <Tooltip
          contentStyle={{
            borderColor: "hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--foreground))"
          }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="precision"
          name="Precision"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="recall"
          name="Recall"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
