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
- **Έξοδα ανά μήνα**: η λίστα είναι χωρισμένη σε μήνες, ο τελευταίος ανοιχτός και οι παλιότεροι πτυσσόμενοι, με σύνολο, πλήθος και προσωπικό υπόλοιπο ανά μήνα και «περισσότερα» όπου χρειάζεται.
- **Στατιστικά**: ανά μήνα σύνολο, πλήθος και μέσο έξοδο, σύγκριση με τον προηγούμενο μήνα και με τον μέσο όρο των 6 προηγούμενων, γράφημα 12 μηνών, ανάλυση ανά κατηγορία (δίπλα στον προηγούμενο μήνα) και ανά μέλος.
- **Υπόλοιπα & εξόφληση**: ποιος χρωστάει σε ποιον, με τις λιγότερες δυνατές πληρωμές. Καταγραφή πληρωμών με ιστορικό.
- **Αλλαγές χρεών**: χειροκίνητη διόρθωση («ο Α χρωστάει 20 € λιγότερα στη Β») χωρίς έξοδο ή πληρωμή, και μεταφορά χρέους σε άλλη ομάδα όπου είναι μέλη και οι δύο (φεύγει από τη μία, εμφανίζεται στην άλλη, διαγράφεται και επαναφέρεται μαζί).
- **Ειδοποιήσεις (push)**: όταν κάποιος προσθέτει έξοδο, τα υπόλοιπα μέλη της ομάδας παίρνουν ειδοποίηση στο κινητό ή στον browser, με το μερίδιό τους. Ενεργοποιείται ανά συσκευή από το Προφίλ (βλ. παρακάτω).
- **Claude (MCP)**: με ένα προσωπικό token το Claude καταχωρεί έξοδα και εξοφλήσεις και απαντά για υπόλοιπα και στατιστικά. Κάθε token βλέπει μόνο τις ομάδες του κατόχου του (βλ. παρακάτω).
- **Εισαγωγή από Splitwise**: το CSV export μιας ομάδας του Splitwise μπαίνει σε μια ομάδα με όλα τα έξοδα και τις πληρωμές (βλ. παρακάτω).
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
| `DISPLAY_TZ` | Ζώνη ώρας που ορίζει το «σήμερα» για το Claude (default `Europe/Athens`) |
| `POSTGRES_*` | Στοιχεία βάσης (εσωτερικά στο docker) |
| `SMTP_*` | Προαιρετικά, για αποστολή email επαναφοράς κωδικού |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Προαιρετικά, για τις ειδοποιήσεις push. Χωρίς αυτά το API φτιάχνει κλειδιά μόνο του (βλ. Ειδοποιήσεις) |

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
Με `-Overlay <φάκελος>` (PowerShell) ή `scripts/deploy.sh <φάκελος>` (sh) τα αρχεία του φακέλου αντιγράφονται πάνω
στο commit πριν ανέβει, για πράγματα που δεν ανήκουν στο git, π.χ. ένα `docker-compose.override.yml` με το CSV μιας
εισαγωγής από Splitwise (βλ. παρακάτω). Το επόμενο απλό deploy τα αφαιρεί.
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

- Μέσα από την εφαρμογή: οι διαχειριστές (`ADMIN_EMAILS` στο `cloudflare-access.env`) έχουν στο
  Προφίλ τους τη σελίδα «Πρόσβαση από το Internet». Προσθήκη email = μπαίνει στην allowlist και
  λαμβάνει email πρόσκλησης (αν υπάρχει SMTP, αλλιώς εμφανίζεται το μήνυμα για αποστολή με το χέρι).
  Αφαίρεση = βγαίνει από την allowlist και, αν το token το επιτρέπει, τερματίζεται η σύνδεσή του.
  Χρειάζεται `CF_API_TOKEN` στο `.env` του server: API token με `Access: Apps and Policies: Edit`
  και `Access: Organizations, Identity Providers, and Groups: Edit` (το δεύτερο μόνο για τον άμεσο
  τερματισμό σύνδεσης), περιορισμένο στον λογαριασμό, χωρίς λήξη.
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

## Claude (MCP)

Το API έχει ένα endpoint για το Claude, `POST /api/mcp` (Model Context Protocol, streamable HTTP, χωρίς sessions).
Τα 29 εργαλεία του (`api/src/mcp/tools.ts`) δεν αγγίζουν τη βάση: καλούν τα ίδια routes με την εφαρμογή, με το token
του χρήστη. Τι δίνεις σε έναν χρήστη: [docs/CLAUDE.md](docs/CLAUDE.md).

**Κάθε token βλέπει μόνο τα δικά του.** Το token αντιστοιχεί σε έναν λογαριασμό (`api_tokens.user_id`) και γίνεται το
`req.user` του αιτήματος. Από εκεί και πέρα ισχύει ό,τι και στην εφαρμογή: η λίστα ομάδων είναι οι ομάδες όπου είναι
μέλος, και κάθε route ομάδας περνά από το `requireMember`. Ομάδα άλλου απαντά «Δεν είστε μέλος αυτής της ομάδας», είτε
για ανάγνωση είτε για αλλαγή.

Το Claude είναι πρόγραμμα και δεν μπορεί να περάσει τη σελίδα σύνδεσης του Cloudflare Access. Για να φτάνει στο
endpoint από το Internet, τρέξε μία φορά (token με `Access: Apps and Policies: Edit`):

```powershell
$env:CLOUDFLARE_API_TOKEN = "..."
node scripts/cloudflare-claude.mjs            # --remove για να κλείσει ξανά
```

Φτιάχνει δεύτερη Access application μόνο για το `bills.ninblack.com/api/mcp` με policy `bypass`. Όλα τα υπόλοιπα
μένουν πίσω από το Access. Στο τοπικό δίκτυο (`http://ninblack-pi.local:8080/api/mcp`) δουλεύει και χωρίς αυτό, αλλά
εκεί το token ταξιδεύει χωρίς κρυπτογράφηση. Από εκεί και πέρα την πόρτα τη φυλάει το API:

- **Προσωπικά tokens** (`bst_` + 256 τυχαία bits). Στη βάση μένει μόνο το SHA-256 τους (`api_tokens`), εμφανίζονται
  μία φορά, λήγουν σε 30 / 90 / 365 ημέρες, ανακαλούνται από το Προφίλ (`deleted_at`, ισχύει αμέσως), ως 10 ανά χρήστη.
- **Δικαιώματα**: `read` (μόνο GET και μόνο τα εργαλεία ανάγνωσης) ή `write`. Κανένα token δεν φτιάχνει ή ανακαλεί
  tokens, δεν αλλάζει κωδικό και δεν φτάνει στη διαχείριση της allowlist· αυτά θέλουν σύνδεση από την εφαρμογή
  (`requireSession`).
- **Όρια**: 10 λάθος tokens ανά διεύθυνση σε 15 λεπτά και μετά `429`· 120 κλήσεις το λεπτό ανά token στο `/api/mcp`.
- Το `/api/mcp` δέχεται μόνο προσωπικά tokens (όχι το JWT της εφαρμογής) και απορρίπτει αιτήματα με ξένο `Origin`.
- **Ίχνος**: γραμμή `mcp tool call` στα logs για κάθε ενέργεια (χρήστης, token, εργαλείο, όχι τα περιεχόμενα).

Το token ταξιδεύει στο header `x-api-key` (σκέτο, χωρίς «Bearer»), άρα η διεύθυνση που δίνεις στους χρήστες πρέπει να
είναι η https. Αν προτιμάς να μην είναι το endpoint ανοιχτό στο Internet, άλλαξε την policy σε `Service Auth` με ένα
Access service token και δώσε στους χρήστες δύο επιπλέον headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`).

## Εισαγωγή από Splitwise

Το export μιας ομάδας του Splitwise (Group settings > Export as spreadsheet, αρχείο CSV) μπαίνει σε μια ομάδα της
εφαρμογής με όλα τα έξοδα και τις πληρωμές του, ώστε τα υπόλοιπα να βγαίνουν ίδια με το Splitwise.

- Κάθε γραμμή του CSV γίνεται ένα έξοδο: πληρωτής είναι όποιος έχει θετική στήλη, οι αρνητικές στήλες είναι τα μερίδια
  των άλλων και ο πληρωτής κρατά το υπόλοιπο. Αν το μερίδιο ταιριάζει με τον κανόνα της ομάδας αποθηκεύεται ως
  «ίδιο με την ομάδα», αλλιώς ως ακριβή ποσά. Οι γραμμές `Payment` γίνονται εξοφλήσεις.
- Οι κατηγορίες του Splitwise αντιστοιχίζονται στις κατηγορίες της εφαρμογής (`Groceries` → Σούπερ μάρκετ, κ.λπ.,
  `General` → καμία). Τα άτομα του αρχείου αντιστοιχίζονται σε μέλη της ομάδας από το όνομα ή το email τους, ή ρητά.
- Το ίδιο αρχείο δεν περνά δύο φορές στην ίδια ομάδα (κρατιέται το sha256 στον πίνακα `imports`). Κάθε έξοδο /
  εξόφληση που μπήκε έχει `import_id`, οπότε μια ολόκληρη εισαγωγή αναιρείται με τρία `UPDATE ... SET deleted_at = now()`
  (στα `expenses`, `settlements` και `imports`).

**Από τη γραμμή εντολών**, στον φάκελο της εφαρμογής (`--dry-run` ελέγχει και δείχνει τι θα γίνει χωρίς να γράψει):

```bash
docker compose run --rm -v "$PWD/export.csv:/import/export.csv:ro" api \
  node dist/import-cli.js /import/export.csv --group "Σπίτι" \
  --users "Όνομα στο Splitwise=a@example.com, Άλλο όνομα=b@example.com" --dry-run
```

**Στην εκκίνηση του API**, για server που φτάνεις μόνο με το deploy key: ένα `docker-compose.override.yml` δίπλα στο
`docker-compose.yml` που δίνει το αρχείο και τις ρυθμίσεις στο `api`. Στην επόμενη εκκίνηση γίνεται η εισαγωγή και
το αποτέλεσμα γράφεται στα logs (`splitwise import done` ή `splitwise import failed` με τον λόγο). Αν ο ίδιος
container ξαναξεκινήσει, το αρχείο αναγνωρίζεται ως ήδη εισηγμένο και δεν γίνεται τίποτα.

```yaml
services:
  api:
    environment:
      IMPORT_SPLITWISE_FILE: /import/export.csv
      IMPORT_SPLITWISE_GROUP: "Σπίτι"          # id ή όνομα, προαιρετικό αν υπάρχει μία ομάδα
      IMPORT_SPLITWISE_USERS: "Όνομα στο Splitwise=a@example.com, Άλλο όνομα=b@example.com"
      IMPORT_SPLITWISE_BY: a@example.com      # ποιος φαίνεται ότι καταχώρησε τα έξοδα (default: ο owner)
      IMPORT_SPLITWISE_DRY_RUN: "1"           # βγάλ' το για την πραγματική εισαγωγή
    volumes:
      - ./import/export.csv:/import/export.csv:ro
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

Tests (διαμοιρασμός, υπόλοιπα, tokens, MCP): `cd api && npm test`.

## Ειδοποιήσεις (push)

Web Push μέσω του service worker της PWA. Κάθε άτομο το ανοίγει **σε κάθε συσκευή χωριστά**: Προφίλ → Ειδοποιήσεις →
«Ενεργοποίηση ειδοποιήσεων», και μετά «Δοκιμή» για να δει ότι φτάνει. Ειδοποίηση στέλνεται για κάθε νέο έξοδο σε όλα τα
μέλη της ομάδας εκτός από αυτό που το καταχώρισε. Η εισαγωγή από Splitwise δεν στέλνει ειδοποιήσεις.

- **Android / υπολογιστής** (Chrome, Edge, Firefox): λειτουργεί από τον browser ή από την εγκατεστημένη εφαρμογή.
- **iPhone / iPad** (iOS 16.4+): μόνο από την εφαρμογή στην αρχική οθόνη (Κοινοποίηση → «Προσθήκη στην οθόνη Αφετηρίας»).
  Μέσα σε καρτέλα του Safari δεν υποστηρίζεται.
- Χρειάζεται HTTPS (π.χ. `https://bills.ninblack.com`) ή `localhost`. Από `http://192.168.x.x:8080` ο browser δεν το επιτρέπει.

Τα κλειδιά VAPID (η «ταυτότητα» του server προς Google / Apple / Mozilla) δημιουργούνται στην πρώτη εκκίνηση και μένουν στον
πίνακα `app_secrets`. Οι συσκευές είναι στον `push_subscriptions`. Η απενεργοποίηση, το logout ή μια συνδρομή που έληξε
βάζουν `deleted_at`. Το subject του VAPID είναι το πρώτο email του `ADMIN_EMAILS`, εκτός αν οριστεί `VAPID_SUBJECT`
(`mailto:...` ή `https://...`). Αν αλλάξουν τα κλειδιά, κάθε συσκευή πρέπει να ενεργοποιήσει ξανά τις ειδοποιήσεις.

Logs: `docker compose logs api | grep push` (`device subscribed`, `notification not delivered`, `subscription expired`).

## API (σύνοψη)

| Method | Path | Περιγραφή |
|---|---|---|
| POST | `/api/auth/signup` · `/login` · `/forgot` · `/reset` | Λογαριασμός |
| GET/PATCH | `/api/auth/me` | Προφίλ |
| GET/POST | `/api/groups` | Ομάδες μου / νέα ομάδα |
| POST | `/api/groups/join` | Συμμετοχή με κωδικό |
| GET/PATCH/DELETE | `/api/groups/:id` | Ομάδα, ρυθμίσεις (split_mode, ποσοστά) |
| POST/DELETE | `/api/groups/:id/members[/:userId]` | Μέλη |
| GET | `/api/groups/:id/expenses/:eid` | Ένα έξοδο με τα μερίδιά του |
| GET/POST/PUT/DELETE | `/api/groups/:id/expenses[/:eid]` | Έξοδα (`?month=YYYY-MM`, `?limit`, `?offset`· η απάντηση έχει και `total`) |
| GET | `/api/groups/:id/expenses/months` | Σύνολα ανά μήνα, ανά κατηγορία και ανά μέλος |
| GET | `/api/groups/:id/balances` | Υπόλοιπα + προτεινόμενες πληρωμές |
| GET/POST/DELETE | `/api/groups/:id/settlements[/:sid]` | Εξοφλήσεις |
| GET/POST/DELETE | `/api/groups/:id/debt-changes[/:cid]` | Αλλαγές χρεών (διορθώσεις) |
| POST | `/api/groups/:id/debt-changes/transfer` | Μεταφορά χρέους σε άλλη ομάδα (`target_group_id`) |
| GET | `/api/groups/:id/debt-changes/targets?debtor=&creditor=` | Ομάδες στις οποίες μπορεί να μεταφερθεί το χρέος |
| GET | `/api/groups/deleted` · `/api/groups/:id/expenses/deleted` · `/api/groups/:id/settlements/deleted` · `/api/groups/:id/debt-changes/deleted` | Διαγραμμένα |
| GET · POST | `/api/push/key` · `/api/push/subscribe` · `/unsubscribe` · `/test` | Ειδοποιήσεις push της συσκευής |
| POST | `/api/groups/:id/restore` · `.../expenses/:eid/restore` · `.../settlements/:sid/restore` · `.../debt-changes/:cid/restore` | Επαναφορά |
| GET/POST | `/api/tokens` · DELETE `/api/tokens/:id` | Προσωπικά tokens (μόνο με σύνδεση από την εφαρμογή) |
| POST | `/api/mcp` | Το endpoint του Claude (MCP), μόνο με προσωπικό token |

Όλα τα endpoints εκτός των auth απαιτούν είτε `x-api-key: <προσωπικό token bst_...>` είτε
`Authorization: Bearer <token>` (το token της σύνδεσης, που στέλνει η εφαρμογή, ή προσωπικό token).

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
