import uuid

from django.db import models


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    units = models.CharField(max_length=4, default="px")
    background = models.CharField(max_length=7, default="#ffffff")
    revision = models.PositiveIntegerField(default=1)
    swatches = models.JSONField(default=list)
    guides = models.JSONField(default=dict)
    size_bytes = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "document"
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["-updated_at"], name="document_updated_idx")]
        constraints = [models.CheckConstraint(condition=models.Q(units__in=["px", "pt", "mm", "cm", "in"]), name="document_units_valid")]

    def __str__(self):
        return self.name


class Artboard(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="artboards")
    key = models.CharField(max_length=64)
    position = models.PositiveIntegerField()
    name = models.CharField(max_length=120)
    x = models.FloatField()
    y = models.FloatField()
    width = models.FloatField()
    height = models.FloatField()

    class Meta:
        db_table = "artboard"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["document", "key"], name="artboard_key_unique"),
            models.UniqueConstraint(fields=["document", "position"], name="artboard_position_unique"),
            models.CheckConstraint(condition=models.Q(width__gt=0, height__gt=0), name="artboard_size_positive"),
        ]


class Layer(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="layers")
    key = models.CharField(max_length=64)
    position = models.PositiveIntegerField()
    name = models.CharField(max_length=120)
    visible = models.BooleanField(default=True)
    locked = models.BooleanField(default=False)
    color = models.CharField(max_length=7, default="#4f7cff")
    items = models.JSONField(default=list)
    item_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "layer"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["document", "key"], name="layer_key_unique"),
            models.UniqueConstraint(fields=["document", "position"], name="layer_position_unique"),
        ]


class Symbol(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="symbols")
    key = models.CharField(max_length=64)
    position = models.PositiveIntegerField()
    name = models.CharField(max_length=120)
    items = models.JSONField(default=list)

    class Meta:
        db_table = "symbol"
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["document", "key"], name="symbol_key_unique")]


class Asset(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="assets")
    key = models.CharField(max_length=64)
    mime = models.CharField(max_length=32)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveIntegerField()
    data = models.BinaryField()

    class Meta:
        db_table = "asset"
        constraints = [
            models.UniqueConstraint(fields=["document", "key"], name="asset_key_unique"),
            models.CheckConstraint(condition=models.Q(mime__in=["image/png", "image/jpeg", "image/gif", "image/webp"]), name="asset_mime_valid"),
        ]
        indexes = [models.Index(fields=["sha256"], name="asset_sha256_idx")]


class DocumentVersion(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="versions")
    revision = models.PositiveIntegerField()
    snapshot = models.JSONField()
    asset_keys = models.JSONField(default=list)
    size_bytes = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "document_version"
        ordering = ["-revision"]
        constraints = [models.UniqueConstraint(fields=["document", "revision"], name="version_revision_unique")]
