# Bill Split – κοινά οικογενειακά έξοδα

Self-hosted εφαρμογή (τύπου Splitwise) για την καταγραφή και τον διαμοιρασμό κοινών εξόδων.
Τρέχει σε browser και σε κινητό (PWA, εγκαθίσταται στην αρχική οθόνη) και είναι dockerized
ώστε να στήνεται σε Raspberry Pi.

## Λειτουργίες

- **Λογαριασμοί**: εγγραφή / σύνδεση με email & κωδικό, «ξέχασα τον κωδικό» με σύνδεσμο επαναφοράς.
- **Ομάδες**: όσες θέλετε (σπίτι, ταξίδι Κρήτη, …). Κάθε ομάδα έχει δικά της έξοδα, υπόλοιπα και εξοφλήσεις, ανεξάρτητα από τις άλλες.
- **Μέλη**: πρόσκληση με κωδικό/σύνδεσμο ή με email υπάρχοντος χρήστη.
- **Κανόνας διαμοιρασμού ανά ομάδα**: ίσα μέρη (π.χ. μισά-μισά) ή ποσοστό ανά μέλος (π.χ. 60/40).
- **Έξοδα**: ποσό, ποιος πλήρωσε, ημερομηνία, κατηγορία. Κάθε έξοδο ακολουθεί την προεπιλογή της ομάδας ή δικό του διαμοιρασμό (ίσα μεταξύ επιλεγμένων, ποσοστά, ακριβή ποσά).
- **Υπόλοιπα & εξόφληση**: ποιος χρωστάει σε ποιον, με τις λιγότερες δυνατές πληρωμές. Καταγραφή πληρωμών με ιστορικό.
- **Mobile-first UI** στα ελληνικά, light/dark mode.

## Αρχιτεκτονική

```
web/   React + Vite + TypeScript (PWA), σερβίρεται από nginx που κάνει και reverse proxy το /api
api/   Node 22 + Express 5 + TypeScript, JWT auth, bcrypt, zod validation
db     PostgreSQL 16 (schema δημιουργείται αυτόματα στην εκκίνηση του api)
```

Όλα τα images είναι multi-arch (amd64 / arm64 / armv7) και δεν έχουν native dependencies,
οπότε χτίζουν κανονικά πάνω στο Raspberry Pi.

## Γρήγορη εκκίνηση (τοπικά ή σε Raspberry Pi)

Προαπαιτούμενα: Docker + Docker Compose (στο Pi: `curl -fsSL https://get.docker.com | sh`).

```bash
git clone https://github.com/mkatsilieris/bill-split.git
cd bill-split
cp .env.example .env
# Άλλαξε τουλάχιστον το JWT_SECRET (π.χ. openssl rand -hex 32) και το APP_URL
docker compose up -d --build
```

Άνοιξε `http://<ip-του-server>:8080` από browser ή κινητό. Στο κινητό επίλεξε
«Προσθήκη στην αρχική οθόνη» για να εγκατασταθεί σαν εφαρμογή.

### Μεταβλητές `.env`

| Μεταβλητή | Περιγραφή |
|---|---|
| `WEB_PORT` | Θύρα στην οποία ακούει η εφαρμογή (default 8080) |
| `APP_URL` | Δημόσιο URL της εφαρμογής, μπαίνει στους συνδέσμους επαναφοράς κωδικού |
| `JWT_SECRET` | Μυστικό υπογραφής των tokens σύνδεσης. **Άλλαξέ το.** |
| `POSTGRES_*` | Στοιχεία βάσης (εσωτερικά στο docker) |
| `SMTP_*` | Προαιρετικά, για αποστολή email επαναφοράς κωδικού |

Αν δεν ρυθμιστεί SMTP, ο σύνδεσμος επαναφοράς τυπώνεται στα logs του API:

```bash
docker compose logs -f api
```

### Χρήσιμες εντολές

```bash
docker compose logs -f            # logs
docker compose pull && docker compose up -d --build   # ενημέρωση μετά από git pull
docker compose exec db pg_dump -U billsplit billsplit > backup.sql   # backup
docker compose down               # στοπ (τα δεδομένα μένουν στο volume pgdata)
```

## Ανάπτυξη (χωρίς docker)

```bash
# βάση
docker compose up -d db
# api (http://localhost:4000)
cd api && npm install && npm run dev
# web (http://localhost:5173, κάνει proxy το /api στο 4000)
cd web && npm install && npm run dev
```

Tests λογικής διαμοιρασμού/υπολοίπων: `cd api && npm test`.

## API (σύνοψη)

| Method | Path | Περιγραφή |
|---|---|---|
| POST | `/api/auth/signup` · `/login` · `/forgot` · `/reset` | Λογαριασμός |
| GET/PATCH | `/api/auth/me` | Προφίλ |
| GET/POST | `/api/groups` | Ομάδες μου / νέα ομάδα |
| POST | `/api/groups/join` | Συμμετοχή με κωδικό |
| GET/PATCH/DELETE | `/api/groups/:id` | Ομάδα, ρυθμίσεις (split_mode, ποσοστά) |
| POST/DELETE | `/api/groups/:id/members[/:userId]` | Μέλη |
| GET/POST/PUT/DELETE | `/api/groups/:id/expenses[/:eid]` | Έξοδα |
| GET | `/api/groups/:id/balances` | Υπόλοιπα + προτεινόμενες πληρωμές |
| GET/POST/DELETE | `/api/groups/:id/settlements[/:sid]` | Εξοφλήσεις |

Όλα τα endpoints εκτός των auth απαιτούν header `Authorization: Bearer <token>`.
