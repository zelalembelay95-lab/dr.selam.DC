// Dr Selam Dental Clinic API
// Express + Firebase Auth (login and roles) + Supabase Postgres (data)
const express = require("express"), cors = require("cors");
const admin = require("firebase-admin");
const { createClient } = require("@supabase/supabase-js");

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const app = express();
app.use(express.json());
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || "*").split(",") }));

const SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","14:00","14:30","15:00","15:30","16:00","16:30"];
const STAFF = ["admin", "ceo", "manager", "receptionist"];
const STATUSES = ["Pending", "Confirmed", "Completed", "Cancelled"];
const isStaff = u => STAFF.includes(u.role);

// wrap async handlers so errors return JSON instead of crashing
const h = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong. Please try again." });
});
// throw on Supabase errors; 23505 = unique violation (slot already taken)
const q = ({ data, error }) => {
  if (error) throw Object.assign(new Error(error.code === "23505" ? "That time is taken." : error.message), { status: error.code === "23505" ? 409 : 500 });
  return data;
};
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// Firebase ID token -> req.user (role and card come from custom claims)
async function auth(req, res, next) {
  try {
    req.user = await admin.auth().verifyIdToken((req.headers.authorization || "").replace("Bearer ", ""));
    next();
  } catch { res.status(401).json({ error: "Please log in." }); }
}
const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Not allowed for your role." });

async function slotTaken(date, time) {
  const rows = q(await sb.from("appointments").select("id").eq("date", date).eq("time", time).neq("status", "Cancelled").limit(1));
  return rows.length > 0;
}

app.get("/health", (_, r) => r.json({ ok: true }));

// Public: which slots are free on a date
app.get("/api/slots", h(async (req, res) => {
  const rows = q(await sb.from("appointments").select("time").eq("date", req.query.date).neq("status", "Cancelled"));
  const taken = rows.map(r => r.time);
  res.json(SLOTS.map(t => ({ time: t, free: !taken.includes(t) })));
}));

// Public: guest booking. Registers a new patient unless a valid card number is given.
app.post("/api/public/appointments", h(async (req, res) => {
  const { name, phone, email, address, card, service, date, time, notes } = req.body;
  if (!service || !date || !time) fail(400, "Service, date and time are required.");
  if (await slotTaken(date, time)) fail(409, "That time is taken.");
  let patient, created = false;
  if (card) {
    const rows = q(await sb.from("patients").select("card").eq("card", card.trim().toUpperCase()).limit(1));
    if (!rows.length) fail(404, "Card number not found.");
    patient = rows[0];
  } else {
    if (!name || !phone || !address) fail(400, "Name, phone and address are required.");
    patient = q(await sb.from("patients").insert({ name, phone, email: email || "", address }).select("card").single());
    created = true;
  }
  const { data, error } = await sb.from("appointments")
    .insert({ card: patient.card, service, date, time, notes: notes || "", booked_by: "Online" }).select("id").single();
  if (error) {
    if (created) await sb.from("patients").delete().eq("card", patient.card); // no orphan patient
    q({ error });
  }
  res.status(201).json({ id: data.id, card: patient.card });
}));

// Signed in: staff see everything, patients see their own
app.get("/api/appointments", auth, h(async (req, res) => {
  let query = sb.from("appointments").select("*, patients(name, phone)").order("date").order("time");
  if (!isStaff(req.user)) query = query.eq("card", req.user.card || "none");
  res.json(q(await query));
}));

app.post("/api/appointments", auth, h(async (req, res) => {
  const staff = isStaff(req.user), { service, date, time } = req.body;
  const card = staff ? req.body.card : req.user.card;
  if (!card || !service || !date || !time) fail(400, "Patient, service, date and time are required.");
  const row = q(await sb.from("appointments").insert({
    card, service, date, time,
    status: staff ? "Confirmed" : "Pending",
    booked_by: staff ? req.user.role : "Patient",
  }).select("id").single());
  res.status(201).json(row);
}));

// Staff can set any status; a patient may only cancel their own booking
app.patch("/api/appointments/:id", auth, h(async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) fail(400, "Bad status.");
  let query = sb.from("appointments").update({ status }).eq("id", req.params.id);
  if (!isStaff(req.user)) {
    if (status !== "Cancelled") fail(403, "Patients can only cancel.");
    query = query.eq("card", req.user.card || "none");
  }
  q(await query);
  res.json({ ok: true });
}));

// Patients (staff only)
app.get("/api/patients", auth, need(...STAFF), h(async (req, res) => {
  const s = (req.query.search || "").replace(/[%,()]/g, "");
  let query = sb.from("patients").select("*").order("created_at", { ascending: false });
  if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,card.ilike.%${s}%`);
  res.json(q(await query));
}));
app.post("/api/patients", auth, need("admin", "manager", "receptionist"), h(async (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name || !phone || !address) fail(400, "Name, phone and address are required.");
  res.status(201).json(q(await sb.from("patients").insert({ name, phone, email: email || "", address }).select().single()));
}));

// Staff accounts live in Firebase Auth; the role is a custom claim
app.post("/api/staff", auth, need("admin"), h(async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!STAFF.includes(role)) fail(400, "Bad role.");
  const u = await admin.auth().createUser({ email, password, displayName: name });
  await admin.auth().setCustomUserClaims(u.uid, { role });
  res.status(201).json({ uid: u.uid });
}));
app.get("/api/staff", auth, need("admin", "ceo", "manager"), h(async (_, res) => {
  const l = await admin.auth().listUsers(200);
  res.json(l.users.filter(u => STAFF.includes(u.customClaims?.role))
    .map(u => ({ uid: u.uid, email: u.email, name: u.displayName, role: u.customClaims.role })));
}));

// Admin: link a patient's Firebase login to their card number
app.post("/api/patients/:card/account", auth, need("admin", "manager", "receptionist"), h(async (req, res) => {
  const { email, password } = req.body;
  const rows = q(await sb.from("patients").select("card,name").eq("card", req.params.card).limit(1));
  if (!rows.length) fail(404, "Card number not found.");
  const u = await admin.auth().createUser({ email, password, displayName: rows[0].name });
  await admin.auth().setCustomUserClaims(u.uid, { card: rows[0].card });
  res.status(201).json({ uid: u.uid });
}));

app.listen(process.env.PORT || 3000, () => console.log("API running"));
