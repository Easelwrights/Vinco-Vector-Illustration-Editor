from django.urls import path

from . import api, views

urlpatterns = [
    path("", views.home, name="home"),
    path("api/v1", api.index),
    path("api/v1/", api.index),
    path("api/v1/health", api.health, name="health"),
    path("api/v1/documents", api.documents, name="documents"),
    path("api/v1/documents/<uuid:document_id>", api.document, name="document"),
    path("api/v1/documents/<uuid:document_id>/svg", api.svg, name="svg"),
    path("api/v1/documents/<uuid:document_id>/export", api.export, name="export"),
    path("api/v1/documents/<uuid:document_id>/versions", api.versions, name="versions"),
    path("api/v1/documents/<uuid:document_id>/versions/<int:revision>/restore", api.restore, name="restore"),
]
