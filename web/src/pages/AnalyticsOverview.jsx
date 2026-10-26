import { useEffect, useState } from "react";
import { getAnalyticsOverview } from "../api/analytics.js";
import { ErrorState, LoadingState } from "../components/PageState.jsx";

const STATUS_META = {
  pending: { label: "Pending", textClass: "text-status-pending", bgClass: "bg-status-pending" },
  active: { label: "Active", textClass: "text-status-active", bgClass: "bg-status-active" },
  resolved: { label: "Resolved", textClass: "text-status-resolved", bgClass: "bg-status-resolved" },
};

export default function AnalyticsOverview() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = () => {
    setIsLoading(true);
    setError(null);
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    getAnalyticsOverview(params)
      .then(setData)
      .catch(() => setError("Could not load analytics."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyFilter = (e) => {
    e.preventDefault();
    loadData();
  };

  const handleClearFilter = () => {
    setDateFrom("");
    setDateTo("");
    setTimeout(loadData, 0);
  };

  if (isLoading) return <LoadingState label="Loading analytics..." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const totalTickets = Object.values(data.tickets_by_status).reduce((sum, count) => sum + count, 0);
  const resolvedTickets = data.tickets_by_status.resolved ?? 0;

  return (
    <section>
      <form onSubmit={handleApplyFilter} className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm text-gray-500">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-500">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:brightness-110"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={handleClearFilter}
          className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-navy transition-colors hover:border-gold"
        >
          Clear
        </button>
      </form>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total Inquiries"
          value={data.total_inquiries}
          accentClass="bg-navy/10 text-navy"
          icon={
            <path
              d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          }
        />
        <StatTile
          label="Total Tickets"
          value={totalTickets}
          accentClass="bg-gold/15 text-gold"
          icon={
            <path
              d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6V7Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          }
        />
        <StatTile
          label="Resolved Tickets"
          value={resolvedTickets}
          accentClass="bg-status-resolved/15 text-status-resolved"
          icon={
            <path
              d="m20 6-11 11-5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          }
        />
        <StatTile
          label="Resolution Rate"
          value={`${Math.round(data.resolution_rate * 100)}%`}
          accentClass="bg-status-active/15 text-status-active"
          icon={
            <path
              d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v4l3 3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-3">
          <SectionHeader
            title="Intent Frequency"
            subtitle="What students are asking about most"
          />
          <IntentFrequencyChart items={data.intent_frequencies} />
          <OtherInteractions items={data.other_interactions} />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
          <SectionHeader title="Tickets by Status" subtitle="Current escalation pipeline" />
          <TicketStatusDonut counts={data.tickets_by_status} total={totalTickets} />
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-6">
      <h4 className="font-semibold text-navy">{title}</h4>
      <p className="text-xs text-gray-400">{subtitle}</p>
    </div>
  );
}

function StatTile({ label, value, icon, accentClass }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${accentClass}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {icon}
        </svg>
      </div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-navy">{value}</p>
    </div>
  );
}

function humanizeIntent(intent) {
  return intent
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function IntentFrequencyChart({ items }) {
  if (!items || items.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">No inquiries logged yet.</p>;
  }

  const maxCount = Math.max(...items.map((item) => item.count));

  return (
    <div className="space-y-5">
      {items.map((item) => {
        const widthPct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
        return (
          <div key={item.intent} className="group">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-navy">{humanizeIntent(item.intent)}</span>
              <span className="font-semibold tabular-nums text-navy">{item.count}</span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
              title={`${humanizeIntent(item.intent)}: ${item.count} inquiries`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-navy to-navy-dark transition-[filter] duration-150 group-hover:brightness-125"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const OTHER_INTERACTION_LABELS = {
  conversational: "Small talk",
  needs_clarification: "Asked to clarify",
  off_topic: "Off-topic",
  unclear: "Unclear",
  duplicate_ticket: "Repeat of open ticket",
};

// Chat turns that aren't new questions - kept out of the topic chart and the
// inquiry total, but still worth seeing (e.g. a high off-topic count).
function OtherInteractions({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Other chatbot interactions (not counted as inquiries)
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item.intent}
            className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
          >
            {OTHER_INTERACTION_LABELS[item.intent] ?? humanizeIntent(item.intent)}{" "}
            <span className="font-semibold tabular-nums text-navy">{item.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TicketStatusDonut({ counts, total }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 ? 3 : 0;
  const [hovered, setHovered] = useState(null);

  const statuses = Object.keys(STATUS_META);
  let cumulative = 0;
  const segments = statuses.map((key) => {
    const count = counts[key] ?? 0;
    const rawLength = total > 0 ? (count / total) * circumference : 0;
    const length = Math.max(rawLength - gap, 0);
    const segment = { key, count, length, offset: cumulative };
    cumulative += rawLength;
    return segment;
  });

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative h-44 w-44 shrink-0">
        {total === 0 ? (
          <svg viewBox="0 0 120 120" className="h-full w-full">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="#F3F4F6" strokeWidth="14" />
          </svg>
        ) : (
          <svg viewBox="0 0 120 120" className="h-full w-full">
            {segments.map((segment) => (
              <circle
                key={segment.key}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="currentColor"
                className={`cursor-default transition-[stroke-width] duration-150 ${STATUS_META[segment.key].textClass}`}
                strokeWidth={hovered === segment.key ? 17 : 14}
                strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                strokeDashoffset={-segment.offset}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
                tabIndex={0}
                role="img"
                aria-label={`${STATUS_META[segment.key].label}: ${segment.count} tickets`}
                onMouseEnter={() => setHovered(segment.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(segment.key)}
                onBlur={() => setHovered(null)}
              />
            ))}
          </svg>
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-navy">{total}</span>
          <span className="text-xs text-gray-400">Tickets</span>
        </div>
      </div>

      <div className="w-full space-y-2">
        {statuses.map((key) => {
          const meta = STATUS_META[key];
          const count = counts[key] ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div
              key={key}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${
                hovered === key ? "bg-gray-50" : ""
              }`}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="flex items-center gap-2 font-medium text-navy">
                <span className={`h-2.5 w-2.5 rounded-full ${meta.bgClass}`} />
                {meta.label}
              </span>
              <span className="tabular-nums text-gray-400">
                <span className="font-semibold text-navy">{count}</span> ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
