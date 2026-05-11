from django.urls import path
from .views import SupportAttachmentDownloadView, SupportMessageDeleteView, SupportTicketActionView, SupportTicketBulkDeleteView, SupportTicketDetailView, SupportTicketListCreateView, SupportTicketReplyView

urlpatterns = [
    path("", SupportTicketListCreateView.as_view(), name="support-ticket-list-create"),
    path("delete-selected/", SupportTicketBulkDeleteView.as_view(), name="support-ticket-delete-selected"),
    path("<int:pk>/", SupportTicketDetailView.as_view(), name="support-ticket-detail"),
    path("<int:pk>/reply/", SupportTicketReplyView.as_view(), name="support-ticket-reply"),
    path("messages/<int:message_id>/attachment/", SupportAttachmentDownloadView.as_view(), name="support-attachment-download"),
    path("messages/<int:message_id>/", SupportMessageDeleteView.as_view(), name="support-message-delete"),
    path("<int:pk>/<str:action>/", SupportTicketActionView.as_view(), name="support-ticket-action"),
]
