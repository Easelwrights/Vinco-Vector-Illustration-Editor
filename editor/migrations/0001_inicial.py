
import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Document",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=120)),
                ("units", models.CharField(default="px", max_length=4)),
                ("background", models.CharField(default="#ffffff", max_length=7)),
                ("revision", models.PositiveIntegerField(default=1)),
                ("swatches", models.JSONField(default=list)),
                ("guides", models.JSONField(default=dict)),
                ("size_bytes", models.PositiveBigIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "document",
                "ordering": ["-updated_at"],
                "indexes": [
                    models.Index(fields=["-updated_at"], name="document_updated_idx")
                ],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            ("units__in", ["px", "pt", "mm", "cm", "in"])
                        ),
                        name="document_units_valid",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="Asset",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("key", models.CharField(max_length=64)),
                ("mime", models.CharField(max_length=32)),
                ("sha256", models.CharField(max_length=64)),
                ("size", models.PositiveIntegerField()),
                ("data", models.BinaryField()),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="assets",
                        to="editor.document",
                    ),
                ),
            ],
            options={
                "db_table": "asset",
                "indexes": [models.Index(fields=["sha256"], name="asset_sha256_idx")],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("document", "key"), name="asset_key_unique"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            (
                                "mime__in",
                                ["image/png", "image/jpeg", "image/gif", "image/webp"],
                            )
                        ),
                        name="asset_mime_valid",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="Artboard",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("key", models.CharField(max_length=64)),
                ("position", models.PositiveIntegerField()),
                ("name", models.CharField(max_length=120)),
                ("x", models.FloatField()),
                ("y", models.FloatField()),
                ("width", models.FloatField()),
                ("height", models.FloatField()),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="artboards",
                        to="editor.document",
                    ),
                ),
            ],
            options={
                "db_table": "artboard",
                "ordering": ["position"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("document", "key"), name="artboard_key_unique"
                    ),
                    models.UniqueConstraint(
                        fields=("document", "position"), name="artboard_position_unique"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("height__gt", 0), ("width__gt", 0)),
                        name="artboard_size_positive",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="DocumentVersion",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("revision", models.PositiveIntegerField()),
                ("snapshot", models.JSONField()),
                ("asset_keys", models.JSONField(default=list)),
                ("size_bytes", models.PositiveBigIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="versions",
                        to="editor.document",
                    ),
                ),
            ],
            options={
                "db_table": "document_version",
                "ordering": ["-revision"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("document", "revision"), name="version_revision_unique"
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="Layer",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("key", models.CharField(max_length=64)),
                ("position", models.PositiveIntegerField()),
                ("name", models.CharField(max_length=120)),
                ("visible", models.BooleanField(default=True)),
                ("locked", models.BooleanField(default=False)),
                ("color", models.CharField(default="#4f7cff", max_length=7)),
                ("items", models.JSONField(default=list)),
                ("item_count", models.PositiveIntegerField(default=0)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="layers",
                        to="editor.document",
                    ),
                ),
            ],
            options={
                "db_table": "layer",
                "ordering": ["position"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("document", "key"), name="layer_key_unique"
                    ),
                    models.UniqueConstraint(
                        fields=("document", "position"), name="layer_position_unique"
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="Symbol",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("key", models.CharField(max_length=64)),
                ("position", models.PositiveIntegerField()),
                ("name", models.CharField(max_length=120)),
                ("items", models.JSONField(default=list)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="symbols",
                        to="editor.document",
                    ),
                ),
            ],
            options={
                "db_table": "symbol",
                "ordering": ["position"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("document", "key"), name="symbol_key_unique"
                    )
                ],
            },
        ),
    ]
