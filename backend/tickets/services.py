from .models import FALLBACK_TICKET_TITLE, Ticket


def create_ticket_from_log(log, office=None, title=FALLBACK_TICKET_TITLE, conversation_context=""):
    return Ticket.objects.create(
        user=log.user,
        log=log,
        title=title,
        conversation_context=conversation_context,
        subject_category="Unresolved Inquiry",
        issue_description=f'Student asked: "{log.user_message}" - AI could not resolve.',
        status=Ticket.Status.PENDING,
        # Pre-assigned from the student's mobile category selection, if any -
        # otherwise left null for Super Admin to route manually, same as before.
        office=office,
    )