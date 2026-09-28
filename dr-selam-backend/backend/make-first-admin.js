// Run once locally: FIREBASE_SERVICE_ACCOUNT='<json>' node make-first-admin.js you@mail.com StrongPassword
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
(async () => {
  const [email, password] = process.argv.slice(2);
  const u = await admin.auth().createUser({ email, password, displayName: "Admin" });
  await admin.auth().setCustomUserClaims(u.uid, { role: "admin" });
  console.log("Admin created:", u.uid);
})();
