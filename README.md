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
- **Τίποτα δεν σβήνεται**: τα διαγραμμένα έξοδα, πληρωμές, ομάδες και μέλη μένουν στη βάση με `deleted_at` και επαναφέρονται. Κάθε αλλαγή κρατά την προηγούμενη τιμή στον πίνακα `row_history`.
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
| `APP_URL` | Δημόσιο URL της εφαρμογής, μπαίνει στους συνδέσμους επαναφοράς κωδικού και είναι το μόνο επιτρεπτό CORS origin |
| `COMPOSE_PROFILES` / `TUNNEL_TOKEN` | `internet` + token του Cloudflare Tunnel για πρόσβαση από το Internet (βλ. παρακάτω). Χωρίς αυτά = μόνο τοπικό δίκτυο |
| `JWT_SECRET` | Μυστικό υπογραφής των tokens σύνδεσης. **Άλλαξέ το.** |
| `POSTGRES_*` | Στοιχεία βάσης (εσωτερικά στο docker) |
| `SMTP_*` | Προαιρετικά, για αποστολή email επαναφοράς κωδικού |

Αν δεν ρυθμιστεί SMTP, ο σύνδεσμος επαναφοράς τυπώνεται στα logs του API:

```bash
docker compose logs -f api
```

### Χρήσιμες εντολές

```bash
docker compose logs -f            # logs (βλ. παρακάτω)
docker compose pull && docker compose up -d --build   # ενημέρωση μετά από git pull
docker compose exec db pg_dump -U billsplit billsplit > backup.sql   # backup
docker compose down               # στοπ (τα δεδομένα μένουν στο volume pgdata)
```

### Logs

Όλα τα containers γράφουν στο stdout και το docker τα κρατάει με rotation (5 αρχεία x 10 MB ανά
service). Οι εντολές τρέχουν από τον φάκελο της εφαρμογής (στο Pi: `/home/deploy/bill-split`), ή από
οπουδήποτε με `docker compose -p bill-split ...`.

```bash
docker compose logs -f api                 # API, ζωντανά
docker compose logs --since 1h api         # η τελευταία ώρα
docker compose logs --tail 200 web         # nginx access log (IP, request, status, χρόνος, reqId)
docker compose logs -f db tunnel           # Postgres / Cloudflare Tunnel
```

Το API γράφει μία γραμμή JSON ανά αίτημα: ποιος χρήστης (`user`), από πού (`ip`), τι (`method`, `url`),
με τι αποτέλεσμα (`status`, `ms`) και, στα σφάλματα, γιατί (`err`). Ξεχωριστές γραμμές υπάρχουν για
είσοδο/αποτυχημένη είσοδο, δημιουργία λογαριασμού, επαναφορά και αλλαγή κωδικού, καθώς και για κάθε
απρόβλεπτο σφάλμα με το πλήρες stack. Κάθε απάντηση έχει header `X-Request-Id`, που εμφανίζεται ως
`reqId` και στα δύο logs (API και nginx), για να ταιριάζεις μια αναφορά χρήστη με τη γραμμή της.

```bash
# Παραδείγματα φιλτραρίσματος (χρειάζεται το jq: sudo apt install jq)
docker compose logs --no-log-prefix api | jq -c 'select(.level=="warn" or .level=="error")'
docker compose logs --no-log-prefix api | jq -c 'select(.user==3)'                 # τι έκανε ο χρήστης 3
docker compose logs --no-log-prefix api | jq -c 'select(.msg=="login failed")'
docker compose logs --no-log-prefix api | jq -c 'select(.status>=500)'
```

Επίπεδο λεπτομέρειας: `LOG_LEVEL=debug|info|warn|error` στο `.env` (προεπιλογή `info`). Οι κωδικοί,
τα tokens και το header Authorization δεν γράφονται ποτέ στα logs.

## Αυτόματο deploy από τον υπολογιστή σου

Ένας ξεχωριστός χρήστης `deploy` στο Pi, με SSH κλειδί που επιτρέπεται να τρέξει **μόνο**
`deploy`, `status`, `logs` και `restart` (όχι shell).

**1. Κλειδί και SSH alias (μία φορά, στον υπολογιστή σου)**

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\billsplit_deploy -C billsplit-deploy   # Enter δύο φορές, χωρίς passphrase
notepad $HOME\.ssh\config
```

Πρόσθεσε στο `config` (άλλαξε το `HostName` αν το Pi σου λέγεται αλλιώς):

```
Host billsplit-pi
    HostName ninblack-pi.local
    User deploy
    IdentityFile ~/.ssh/billsplit_deploy
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
```

**2. Χρήστης deploy στο Pi (μία φορά)**

```powershell
scp scripts\pi-setup-deploy.sh $HOME\.ssh\billsplit_deploy.pub <user>@ninblack-pi.local:~/
ssh -t <user>@ninblack-pi.local "sudo sh ~/pi-setup-deploy.sh ~/billsplit_deploy.pub"
```

Το script φτιάχνει τον χρήστη, τον φάκελο `/home/deploy/bill-split` και ένα `.env` με τυχαία μυστικά
(ή αντιγράφει το `~/bill-split/.env` αν υπάρχει ήδη χειροκίνητη εγκατάσταση).

**3. Κάθε φορά που θες να ανεβάσεις το τελευταίο commit**

```powershell
.\scripts\deploy.ps1          # Windows PowerShell
scripts/deploy.sh             # Git Bash / Linux / macOS
ssh billsplit-pi status       # κατάσταση containers
ssh billsplit-pi logs api     # τελευταίες 200 γραμμές (db | api | web | tunnel)
```

Ανεβαίνει μόνο ό,τι έχει γίνει commit. Το `.env` στο Pi δεν αλλάζει ποτέ από το deploy.
Όποιος έχει το κλειδί μπορεί να ανεβάσει κώδικα στο Pi, οπότε κράτα το ιδιωτικό.

## Πρόσβαση από το Internet (Cloudflare Tunnel + Access)

Η εφαρμογή βγαίνει στο Internet ως `https://bills.ninblack.com` **χωρίς** άνοιγμα θύρας στο router:
το container `tunnel` (cloudflared) ανοίγει εξερχόμενη σύνδεση προς το Cloudflare, και το
Cloudflare Access βάζει μπροστά μια σελίδα σύνδεσης με κωδικό μίας χρήσης στο email. Μόνο τα
emails της allowlist περνούν. Όλα αυτά είναι στο δωρεάν Zero Trust plan (έως 50 χρήστες).

Τι υπάρχει στο Cloudflare (λογαριασμός του `ninblack.com`):

| Πού | Τι |
|---|---|
| Zero Trust > Networks > Tunnels | Tunnel `bill-split`, public hostname `bills.ninblack.com` → `http://web:80` |
| DNS | `CNAME bills` → `<tunnel-id>.cfargotunnel.com` (proxied) |
| Zero Trust > Access > Applications | Εφαρμογή `Bill Split`, policy `Family` (Allow, Emails: …) |
| Zero Trust > Settings > Authentication | Login methods: One-time PIN (email) |

**Στο Pi** (μία φορά) πρόσθεσε στο `/home/deploy/bill-split/.env`:

```
APP_URL=https://bills.ninblack.com
COMPOSE_PROFILES=internet
TUNNEL_TOKEN=<το token από Zero Trust > Networks > Tunnels > bill-split > Configure>
```

και μετά `scripts/deploy.ps1` (ή `ssh billsplit-pi restart` αν δεν άλλαξε ο κώδικας).

**Ένα login αντί για δύο (SSO).** Όταν ο χρήστης έχει περάσει το Access, το Cloudflare βάζει σε κάθε
request ένα υπογεγραμμένο JWT (header `Cf-Access-Jwt-Assertion`). Το API το επαληθεύει με τα δημόσια
κλειδιά του team (`ACCESS_TEAM_DOMAIN`) και το application audience (`ACCESS_AUD`, αρχείο
`cloudflare-access.env`) και συνδέει αυτόματα τον χρήστη με το email του, δημιουργώντας λογαριασμό
την πρώτη φορά. Από το τοπικό δίκτυο, που δεν περνά από Cloudflare, εμφανίζεται η κανονική φόρμα.
Για να απενεργοποιηθεί (π.χ. αν καταργηθεί το Cloudflare) αρκεί να αδειάσουν οι δύο τιμές στο
`cloudflare-access.env`. Η «Αποσύνδεση» μέσα από το Access τερματίζει και το Access session.

**Προσθήκη / αφαίρεση μέλους στην allowlist**

- Dashboard: Zero Trust > Access > Applications > Bill Split > Policies > Family > Include > Emails.
- Ή με το script (χρειάζεται API token με `Access: Apps and Policies: Edit`):

```powershell
$env:CLOUDFLARE_API_TOKEN = "..."
scripts/access-allowlist.ps1 -Emails a@example.com, b@example.com   # αντικαθιστά όλη τη λίστα
```

Ο αριθμός χρηστών (seats) του Zero Trust δεν μπορεί να ξεπεράσει το μήκος της allowlist, άρα το
plan μένει δωρεάν. Αν κάποιος φύγει, βγάλε τον και από Zero Trust > My Team > Users για να
ελευθερωθεί το seat.

**Σημειώσεις**

- Στο τοπικό δίκτυο η εφαρμογή παραμένει διαθέσιμη στο `http://ninblack-pi.local:8080` χωρίς Access.
- Χωρίς `COMPOSE_PROFILES=internet` το container `tunnel` δεν δημιουργείται καθόλου.
- Logs του tunnel: `ssh billsplit-pi logs tunnel`.

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
| GET | `/api/groups/deleted` · `/api/groups/:id/expenses/deleted` · `/api/groups/:id/settlements/deleted` | Διαγραμμένα |
| POST | `/api/groups/:id/restore` · `/api/groups/:id/expenses/:eid/restore` · `/api/groups/:id/settlements/:sid/restore` | Επαναφορά |

Όλα τα endpoints εκτός των auth απαιτούν header `Authorization: Bearer <token>`.

## Διαγραφές και ιστορικό

Το `DELETE` του API βάζει `deleted_at` / `deleted_by`, και triggers στη βάση απορρίπτουν κάθε πραγματικό `DELETE` ή
`TRUNCATE`. Εξαίρεση είναι το `DELETE` στο `expense_shares`: η επεξεργασία εξόδου αντικαθιστά τα μερίδια, και τα παλιά μένουν
στο `row_history`.

Για αναίρεση επεξεργασίας, το `row_history` έχει την παλιά γραμμή ως JSON (χωρίς `password_hash`). Όσες γραμμές άλλαξαν στην
ίδια συναλλαγή έχουν το ίδιο `changed_at`:

```sql
SELECT table_name, operation, old_row, changed_at FROM row_history
 WHERE (table_name = 'expenses' AND old_row->>'id' = '42')
    OR (table_name = 'expense_shares' AND old_row->>'expense_id' = '42')
 ORDER BY changed_at DESC;
```
