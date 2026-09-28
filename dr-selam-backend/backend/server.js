// Dr Selam Dental Clinic API: Express + Firebase Admin (Auth + Firestore)
const express = require("express"), cors = require("cors"), admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore(), app = express();
app.use(express.json());
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || "*").split(",") }));

const SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","14:00","14:30","15:00","15:30","16:00","16:30"];
const STAFF = ["admin", "ceo", "manager", "receptionist"];

// Verify Firebase ID token; role comes from a custom claim
async function auth(req, res, next) {
  try {
    const t = (req.headers.authorization || "").replace("Bearer ", "");
    req.user = await admin.auth().verifyIdToken(t);
    next();
  } catch { res.status(401).json({ error: "Please log in." }); }
}
const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Not allowed for your role." });

async function nextCard() {
  const ref = db.doc("meta/counters");
  return db.runTransaction(async tx => {
    const n = ((await tx.get(ref)).data()?.patients || 0) + 1;
    tx.set(ref, { patients: n }, { merge: true });
    return "DS-" + String(n).padStart(4, "0");
  });
}
async function slotTaken(date, time) {
  const s = await db.collection("appointments").where("date", "==", date).where("time", "==", time).get();
  return s.docs.some(d => d.data().status !== "Cancelled");
}

app.get("/health", (_, r) => r.json({ ok: true }));

// Public: free slots for a date
app.get("/api/slots", async (req, res) => {
  const s = await db.collection("appointments").where("date", "==", req.query.date).get();
  const taken = s.docs.map(d => d.data()).filter(a => a.status !== "Cancelled").map(a => a.time);
  res.json(SLOTS.map(t => ({ time: t, free: !taken.includes(t) })));
});

// Public: guest booking (registers a new patient unless a valid card is given)
app.post("/api/public/appointments", async (req, res) => {
  const { name, phone, email, address, card, service, date, time, notes } = req.body;
  if (!service || !date || !time) return res.status(400).json({ error: "Service, date and time are required." });
  if (await slotTaken(date, time)) return res.status(409).json({ error: "That time is taken." });
  let patient;
  if (card) {
    const d = await db.doc("patients/" + card).get();
    if (!d.exists) return res.status(404).json({ error: "Card number not found." });
    patient = d.data();
  } else {
    if (!name || !phone || !address) return res.status(400).json({ error: "Name, phone and address are required." });
    patient = { card: await nextCard(), name, phone, email: email || "", address, createdAt: Date.now() };
    await db.doc("patients/" + patient.card).set(patient);
  }
  const a = { card: patient.card, service, date, time, notes: notes || "", status: "Pending", by: "Online", createdAt: Date.now() };
  const ref = await db.collection("appointments").add(a);
  res.status(201).json({ id: ref.id, card: patient.card });
});

// Signed in: staff see all, patients see their own
app.get("/api/appointments", auth, async (req, res) => {
  let q = db.collection("appointments");
  if (!STAFF.includes(req.user.role)) q = q.where("card", "==", req.user.card);
  res.json((await q.get()).docs.map(d => ({ id: d.id, ...d.data() })));
});
app.post("/api/appointments", auth, async (req, res) => {
  const isStaff = STAFF.includes(req.user.role);
  const { card, service, date, time } = req.body;
  const c = isStaff ? card : req.user.card;
  if (await slotTaken(date, time)) return res.status(409).json({ error: "That time is taken." });
  const a = { card: c, service, date, time, notes: "", status: isStaff ? "Confirmed" : "Pending", by: isStaff ? req.user.role : "Patient", createdAt: Date.now() };
  res.status(201).json({ id: (await db.collection("appointments").add(a)).id });
});
app.patch("/api/appointments/:id", auth, need(...STAFF), async (req, res) => {
  if (!["Pending","Confirmed","Completed","Cancelled"].includes(req.body.status)) return res.status(400).json({ error: "Bad status." });
  await db.doc("appointments/" + req.params.id).update({ status: req.body.status });
  res.json({ ok: true });
});

// Patients (staff only)
app.get("/api/patients", auth, need(...STAFF), async (_, res) =>
  res.json((await db.collection("patients").get()).docs.map(d => d.data())));
app.post("/api/patients", auth, need("admin", "manager", "receptionist"), async (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name || !phone || !address) return res.status(400).json({ error: "Name, phone and address are required." });
  const p = { card: await nextCard(), name, phone, email: email || "", address, createdAt: Date.now() };
  await db.doc("patients/" + p.card).set(p);
  res.status(201).json(p);
});

// Admin: create a staff account with a role
app.post("/api/staff", auth, need("admin"), async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!STAFF.includes(role)) return res.status(400).json({ error: "Bad role." });
  const u = await admin.auth().createUser({ email, password, displayName: name });
  await admin.auth().setCustomUserClaims(u.uid, { role });
  res.status(201).json({ uid: u.uid });
});
app.get("/api/staff", auth, need("admin", "ceo", "manager"), async (_, res) => {
  const l = await admin.auth().listUsers(200);
  res.json(l.users.filter(u => STAFF.includes(u.customClaims?.role)).map(u => ({ uid: u.uid, email: u.email, name: u.displayName, role: u.customClaims.role })));
});

app.listen(process.env.PORT || 3000, () => console.log("API running"));
