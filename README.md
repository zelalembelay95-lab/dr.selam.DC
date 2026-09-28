# Dr Selam Dental Clinic: website and appointment system

```
frontend/   Website (index.html) + logo files. Runs as-is; data is stored in the browser (demo mode).
backend/    Node + Express API for Render. Firebase Auth (roles) + Firestore (patients, appointments).
render.yaml Render blueprint for the API and the static site.
```

## 1. Firebase
1. Create a project at console.firebase.google.com.
2. Build > Authentication > enable Email/Password.
3. Build > Firestore Database > create (production mode).
4. Project settings > Service accounts > Generate new private key. Keep this JSON secret.
5. Create the first admin (run locally):
   `cd backend && npm install && FIREBASE_SERVICE_ACCOUNT='<json on one line>' node make-first-admin.js you@mail.com StrongPassword`
6. Roles are Firebase custom claims: admin, ceo, manager, receptionist. Admin adds other staff through `POST /api/staff`.
7. Patients: give each patient a Firebase login whose token carries a `card` claim (their DS-number) and no staff role.

## 2. Render
1. Push this folder to a GitHub repository.
2. Render > New > Blueprint > pick the repo (uses render.yaml).
3. Set the environment variables on `dr-selam-api`:
   - `FIREBASE_SERVICE_ACCOUNT` = the service-account JSON on one line
   - `ALLOWED_ORIGINS` = your site URL(s)
4. Test: open `https://<your-api>.onrender.com/health`.

## 3. Cloudflare (domain and DNS)
1. Add your domain to Cloudflare and switch the registrar nameservers to Cloudflare's.
2. Render > dr-selam-site > Settings > Custom Domains: add `yourdomain.com` and `www`.
3. Cloudflare > DNS: add the CNAME records Render shows (`www` and the root, which Cloudflare flattens). Optionally add `api` pointing to the API service.
4. SSL/TLS mode: Full (strict). Keep the orange-cloud proxy on.

## 4. Connecting the frontend to the API
The included `frontend/index.html` is a working demo on browser storage. To go live, replace its `db` reads and writes with `fetch()` calls to the endpoints in `backend/server.js`, and its login form with the Firebase Web SDK `signInWithEmailAndPassword`, sending the ID token as `Authorization: Bearer <token>`.

## API summary
| Method | Path | Who |
|---|---|---|
| GET | /api/slots?date=YYYY-MM-DD | public |
| POST | /api/public/appointments | public (guest booking and auto-registration) |
| GET, POST | /api/appointments | signed in (staff see all, patients see own) |
| PATCH | /api/appointments/:id | staff |
| GET | /api/patients | staff |
| POST | /api/patients | admin, manager, receptionist |
| GET | /api/staff | admin, ceo, manager |
| POST | /api/staff | admin |
