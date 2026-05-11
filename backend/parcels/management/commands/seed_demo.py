from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction

from documents.models import ParcelDocument
from notifications.models import Notification
from parcels.models import Parcel, ParcelSide, ParcelTimelineEvent
from support.models import SupportTicket

User = get_user_model()


DEMO_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [
        [
            [2.3521, 48.8566],
            [2.3532, 48.8566],
            [2.3531, 48.8573],
            [2.3520, 48.8572],
            [2.3521, 48.8566],
        ]
    ],
}


class Command(BaseCommand):
    help = "Crée un jeu de données de démonstration cohérent pour MAPGEO."

    @transaction.atomic
    def handle(self, *args, **options):
        admin, _ = User.objects.update_or_create(
            username="admin",
            defaults={
                "email": "admin@mapgeo.local",
                "first_name": "Admin",
                "last_name": "MAPGEO",
                "role": "admin",
                "is_staff": True,
                "is_superuser": True,
                "is_verified": True,
            },
        )
        admin.set_password("Admin1234!")
        admin.save()

        client, _ = User.objects.update_or_create(
            username="client1",
            defaults={
                "email": "client1@mapgeo.local",
                "first_name": "Awa",
                "last_name": "Traoré",
                "role": "client",
                "client_code": "CLI001",
                "company_name": "Client Démo",
                "phone": "+221 70 000 00 00",
                "is_verified": True,
            },
        )
        client.set_password("Test1234!")
        client.save()

        parcel, _ = Parcel.objects.update_or_create(
            reference="PARCEL-001",
            defaults={
                "owner": client,
                "title_number": "TF-2026-001",
                "parcel_number": "1",
                "section": "A",
                "location": "Zone pilote MAPGEO",
                "address": "Rue de la Démo",
                "village": "Centre",
                "commune": "Dakar",
                "department": "Dakar",
                "region": "Dakar",
                "land_use": "Habitation",
                "area": 845.0,
                "perimeter": 118.0,
                "status": "processing",
                "survey_date": date.today() - timedelta(days=6),
                "method": "GNSS RTK",
                "latitude": 48.85695,
                "longitude": 2.35265,
                "geometry": DEMO_GEOMETRY,
                "orientation": "Nord-Est",
                "access_info": "Accès par voie secondaire",
                "risk_level": "Modéré",
                "notes": "Parcelle de démonstration pour vérifier la vue dossier et la fenêtre cartographique.",
            },
        )

        ParcelSide.objects.filter(parcel=parcel).delete()
        ParcelSide.objects.bulk_create([
            ParcelSide(parcel=parcel, label="AB", length=28.50, point_a="A", point_b="B", boundary_state="stable"),
            ParcelSide(parcel=parcel, label="BC", length=30.10, point_a="B", point_b="C", boundary_state="stable"),
            ParcelSide(parcel=parcel, label="CD", length=29.30, point_a="C", point_b="D", boundary_state="à vérifier"),
            ParcelSide(parcel=parcel, label="DA", length=30.10, point_a="D", point_b="A", boundary_state="stable"),
        ])

        ParcelTimelineEvent.objects.filter(parcel=parcel).delete()
        ParcelTimelineEvent.objects.bulk_create([
            ParcelTimelineEvent(parcel=parcel, title="Mission créée", description="Ouverture du dossier.", event_date=date.today() - timedelta(days=10), progress=15),
            ParcelTimelineEvent(parcel=parcel, title="Levé terrain", description="Levé GNSS réalisé.", event_date=date.today() - timedelta(days=6), progress=45),
            ParcelTimelineEvent(parcel=parcel, title="Traitement", description="Assemblage et vérification des données.", event_date=date.today() - timedelta(days=2), progress=72),
        ])

        if not ParcelDocument.objects.filter(parcel=parcel, title="Plan de situation").exists():
            document = ParcelDocument(
                parcel=parcel,
                title="Plan de situation",
                document_type="plan_pdf",
                version="v1",
                status="validated",
                description="Document de démonstration généré automatiquement.",
                is_public_for_client=True,
            )
            document.file.save("plan-situation-demo.txt", ContentFile("Document de démonstration MAPGEO"), save=True)

        Notification.objects.update_or_create(
            user=admin,
            title="Jeu de données démo prêt",
            defaults={
                "message": "Le compte admin et la parcelle de démonstration ont été créés.",
                "notification_type": "success",
                "is_read": False,
            },
        )
        Notification.objects.update_or_create(
            user=client,
            title="Votre dossier est disponible",
            defaults={
                "message": "La parcelle PARCEL-001 est visible dans votre espace client.",
                "notification_type": "parcel",
                "is_read": False,
            },
        )

        SupportTicket.objects.update_or_create(
            user=client,
            parcel=parcel,
            subject="Question sur le bornage",
            defaults={
                "message": "Pouvez-vous confirmer la prochaine étape après le traitement ?",
                "status": "open",
                "priority": "medium",
            },
        )

        self.stdout.write(self.style.SUCCESS("Données de démonstration créées."))
        self.stdout.write("Admin : admin / Admin1234!")
        self.stdout.write("Client : client1 / Test1234! (email: client1@mapgeo.local, code: CLI001)")
        self.stdout.write(f"Parcelle démo : id={parcel.id}, référence={parcel.reference}")
