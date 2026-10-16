import { Fragment, useEffect, useState } from "react";
import { getTickets, updateTicket } from "../api/tickets.js";
import { getOffices } from "../api/offices.js";
import TicketStatusBadge from "../components/TicketStatusBadge.jsx";
import Pagination from "../components/Pagination.jsx";
import { ErrorState, LoadingState } from "../components/PageState.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const ESCALATED_PREFIX = /^Student asked: "(.*)" - AI could not resolve\.$/s;

function displayIssue(issueDescription) {
  const match = ESCALATED_PREFIX.exec(issueDescription);
  return match ? match[1] : issueDescription;
}

export default function TicketManagement() {
  const { currentUser } = useAuth();
  const isOfficeAdmin = currentUser?.role === "office_admin";
  const [tickets, setTickets] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [offices, setOffices] = useState([]);
  const [knownCategories, setKnownCategories] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [officeFilter, setOfficeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [expandedTicketId, setExpandedTicketId] = useState(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isAssigningOffice, setIsAssigningOffice] = useState(false);

  const loadTickets = () => {
    setIsLoading(true);
    getTickets({
      page,
      search: debouncedSearch || undefined,
      category: categoryFilter === "All" ? undefined : categoryFilter,
      office: officeFilter === "All" || officeFilter === "Unassigned" ? undefined : officeFilter,
      status: statusFilter === "All" ? undefined : statusFilter,
    })
      .then((res) => {
        const rows = res.data.results ?? res.data;
        setTickets(rows);
        setTotalCount(res.data.count ?? rows.length);
        setKnownCategories((prev) => {
          const next = new Set(prev);
          rows.forEach((t) => next.add(t.subject_category));
          return next;
        });
      })
      .catch(() => setError("Could not load tickets."))
      .finally(() => setIsLoading(false));
  };

  // Stat tiles reflect true totals regardless of the active search/category/
  // office/status filters - office-admin scoping still applies server-side.
  const loadCounts = () => {
    Promise.all([
      getTickets({ page: 1 }),
      getTickets({ page: 1, status: "pending" }),
      getTickets({ page: 1, status: "resolved" }),
    ])
      .then(([all, pending, resolved]) => {
        setAllCount(all.data.count ?? (all.data.results ?? all.data).length);
        setPendingCount(pending.data.count ?? (pending.data.results ?? pending.data).length);
        setResolvedCount(resolved.data.count ?? (resolved.data.results ?? resolved.data).length);
      })
      .catch(() => {});
  };

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, categoryFilter, officeFilter]);

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, statusFilter, categoryFilter, officeFilter]);

  useEffect(() => {
    loadCounts();
    getOffices()
      .then((res) => setOffices(res.data.results ?? res.data))
      .catch(() => {});
  }, []);

  const handleToggleRow = (ticket) => {
    if (expandedTicketId === ticket.ticket_id) {
      setExpandedTicketId(null);
      return;
    }
    setExpandedTicketId(ticket.ticket_id);
    setAnswerDraft(ticket.resolution ?? "");
    setCategoryDraft(ticket.subject_category);
  };

  const handleSendAnswer = async (ticketId) => {
    const trimmed = answerDraft.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    try {
      await updateTicket(ticketId, {
        resolution: trimmed,
        status: "resolved",
        subject_category: categoryDraft.trim() || undefined,
      });
      setExpandedTicketId(null);
      setAnswerDraft("");
      loadTickets();
      loadCounts();
    } finally {
      setIsSending(false);
    }
  };

  const handleUpdateCategory = async (ticketId) => {
    const trimmed = categoryDraft.trim();
    if (!trimmed) return;
    await updateTicket(ticketId, { subject_category: trimmed });
    loadTickets();
  };

  const handleAssignOffice = async (ticketId, officeId) => {
    setIsAssigningOffice(true);
    try {
      await updateTicket(ticketId, { office: officeId || null });
      loadTickets();
    } finally {
      setIsAssigningOffice(false);
    }
  };

  const handleStatTileClick = (status) => {
    setStatusFilter((prev) => (prev === status ? "All" : status));
  };

  if (isLoading && tickets.length === 0) return <LoadingState label="Loading tickets..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <section>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Total Tickets"
          value={allCount}
          accentClass="bg-navy/10 text-navy"
          isActive={statusFilter === "All"}
          onClick={() => handleStatTileClick("All")}
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
          label="Pending"
          value={pendingCount}
          accentClass="bg-status-pending/15 text-status-pending"
          isActive={statusFilter === "pending"}
          onClick={() => handleStatTileClick("pending")}
          icon={
            <path
              d="M12 8v4l3 3M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          }
        />
        <StatTile
          label="Resolved"
          value={resolvedCount}
          accentClass="bg-status-resolved/15 text-status-resolved"
          isActive={statusFilter === "resolved"}
          onClick={() => handleStatTileClick("resolved")}
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
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-lg font-bold text-navy">All Tickets</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gold/40"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"
        >
          <option value="All">All Category</option>
          {[...knownCategories].sort().map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        {!isOfficeAdmin && (
          <select
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value)}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"
          >
            <option value="All">All Offices</option>
            <option value="Unassigned">Unassigned</option>
            {offices.map((o) => (
              <option key={o.office_id} value={String(o.office_id)}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-5 py-3">Ticket</th>
              <th className="px-5 py-3">From</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Office</th>
              <th className="px-5 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center text-sm text-gray-500">
                  No tickets yet.
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => (
                <Fragment key={ticket.ticket_id}>
                  <tr
                    onClick={() => handleToggleRow(ticket)}
                    className="cursor-pointer border-b border-gray-50 text-navy transition-colors last:border-0 hover:bg-gray-50/80"
                  >
                    <td className="max-w-md px-5 py-3.5">
                      <div className="truncate font-semibold">
                        {ticket.title} <span className="font-normal text-gray-400">— Ticket #{ticket.ticket_id}</span>
                      </div>
                      <div className="truncate text-sm text-gray-500">{displayIssue(ticket.issue_description)}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-bold text-navy">
                          #{ticket.user_id}
                        </div>
                        <span className="text-gray-500">Student</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{ticket.subject_category}</td>
                    <td className="px-5 py-3.5 text-sm">
                      {ticket.office_name ? (
                        <span className="whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                          {ticket.office_name}
                        </span>
                      ) : (
                        <span className="italic text-gray-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <TicketStatusBadge status={ticket.status} />
                    </td>
                  </tr>
                  {expandedTicketId === ticket.ticket_id && (
                    <tr className="border-b border-gray-50 bg-gray-50/60">
                      <td colSpan={5} className="px-5 py-3">
                        {ticket.conversation_context && (
                          <div className="mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Conversation before escalation
                            </p>
                            <p className="whitespace-pre-wrap text-sm text-navy">{ticket.conversation_context}</p>
                          </div>
                        )}
                        <div
                          className="mb-3 flex flex-wrap items-center gap-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-600">Category:</label>
                            <input
                              type="text"
                              value={categoryDraft}
                              onChange={(e) => setCategoryDraft(e.target.value)}
                              onBlur={() => handleUpdateCategory(ticket.ticket_id)}
                              className="w-48 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40"
                            />
                          </div>
                          {!isOfficeAdmin && (
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium text-gray-600">Route to office:</label>
                              <select
                                value={ticket.office ?? ""}
                                disabled={isAssigningOffice}
                                onChange={(e) => handleAssignOffice(ticket.ticket_id, e.target.value)}
                                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-gold/40 disabled:opacity-50"
                              >
                                <option value="">Unassigned</option>
                                {offices.map((o) => (
                                  <option key={o.office_id} value={o.office_id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div
                          className="flex items-end gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <textarea
                            rows={2}
                            value={answerDraft}
                            onChange={(e) => setAnswerDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSendAnswer(ticket.ticket_id);
                              }
                            }}
                            placeholder="State your answer..."
                            className="flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gold/40"
                          />
                          <button
                            type="button"
                            onClick={() => handleSendAnswer(ticket.ticket_id)}
                            disabled={!answerDraft.trim() || isSending}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-white transition-opacity hover:brightness-95 disabled:opacity-40"
                            aria-label="Send answer"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 20l16-8L4 4v6l10 2-10 2v6z" fill="currentColor" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
        </div>
        <Pagination page={page} count={totalCount} onPageChange={setPage} />
      </div>
    </section>
  );
}

function StatTile({ label, value, icon, accentClass, isActive, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition-all ${
        isActive ? "border-gold ring-2 ring-gold/30" : "border-gray-200 hover:border-gold/50"
      }`}
    >
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${accentClass}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {icon}
        </svg>
      </div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-navy">{value}</p>
    </button>
  );
}
