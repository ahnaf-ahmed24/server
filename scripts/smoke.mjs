import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn, execSync } from "node:child_process";
import net from "node:net";


function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
    probe.on("error", reject);
  });
}


function killTree(child) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

let passed = 0;
let failed = 0;
const failures = [];


let API = "";

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}


class Session {
  cookie = "";
  async call(path, { method = "GET", body } = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookie) this.cookie = raw.split(";")[0];
    let json = null;
    try {
      json = await res.json();
    } catch {

    }
    return { status: res.status, json };
  }
  clear() {
    this.cookie = "";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("[smoke] starting in-memory MongoDB…");
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri("studiospace");

  const API_PORT = await freePort();
  API = `http://127.0.0.1:${API_PORT}/api`;
  console.log("[smoke] starting API on port", API_PORT);
  const child = spawn("npx", ["tsx", "src/server.ts"], {
    shell: process.platform === "win32",
    env: {
      ...process.env,
      PORT: String(API_PORT),
      MONGODB_URI: uri,
      DB_NAME: "studiospace",
      JWT_SECRET: "smoke_test_secret",
      CLIENT_ORIGINS: "http://localhost:3000",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLines = [];
  child.stdout.on("data", (d) => serverLines.push(String(d)));
  child.stderr.on("data", (d) => serverLines.push(String(d)));

  try {

    let healthy = false;
    for (let i = 0; i < 60 && !healthy; i++) {
      await sleep(500);
      try {
        const res = await fetch(`${API}/health`);
        healthy = res.ok;
      } catch {

      }
    }
    if (!healthy) {
      throw new Error(`API never became healthy:\n${serverLines.join("")}`);
    }
    console.log("[smoke] API is up — exercising the contract\n");

    const A = new Session(); 
    const B = new Session();
    const guest = new Session();


    let r = await A.call("/auth/register", {
      method: "POST",
      body: {
        name: "Smoke Tester",
        email: "smoke@studiospace.dev",
        password: "Passw0rd",
      },
    });
    check("register issues JWT cookie + user", r.status === 201 && !!r.json?.data?.user?.email);

    r = await A.call("/auth/me");
    check("me returns the signed-in user", r.json?.data?.user?.email === "smoke@studiospace.dev");

    r = await A.call("/auth/login", {
      method: "POST",
      body: { email: "smoke@studiospace.dev", password: "wrongpw" },
    });
    check("wrong password rejected", r.status === 401 && r.json?.success === false);

    r = await B.call("/auth/register", {
      method: "POST",
      body: {
        name: "Second Creator",
        email: "second@studiospace.dev",
        photoURL: "",
        password: "Passw0rd",
      },
    });
    check("second account created", r.status === 201);

    r = await guest.call("/auth/me");
    check("guest me returns user:null", r.status === 200 && r.json?.data?.user === null);


    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const date = tomorrow.toISOString().slice(0, 10);

    const studioInput = {
      title: "Aurora Photo Loft",
      category: "Photo Studios",
      hourlyRate: 45,
      deposit: 100,
      capacity: 8,
      location: "Dhanmondi, Dhaka",
      image: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=1200&q=80",
      gallery: [
        "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=1200&q=80",
        "https://images.unsplash.com/photo-1554048612-b6a482bc67e5?w=1200&q=80",
      ],
      amenities: ["Cyc Wall", "Lighting Kit", "Backdrops"],
      overview: "A bright loft with a curved cyc wall and a full lighting kit.",
    };

    r = await A.call("/studios", { method: "POST", body: studioInput });
    check("create studio (auth) → 201", r.status === 201, JSON.stringify(r.json));
    const studioId = r.json?.data?.studio?._id;
    check("studio owner identity comes from the JWT", r.json?.data?.studio?.ownerEmail === "smoke@studiospace.dev"
      && r.json?.data?.studio?.ownerName === "Smoke Tester");

    r = await B.call("/studios", { method: "POST", body: { ...studioInput, title: "Harbor Photo Wall" } });
    check("second host can publish too → 201", r.status === 201);
    const secondStudioId = r.json?.data?.studio?._id;

    r = await guest.call("/studios", { method: "POST", body: studioInput });
    check("create studio without auth → 401", r.status === 401);

    r = await guest.call("/studios?limit=6&sort=rating");
    check("featured/list returns both studios", r.json?.data?.items?.length === 2);

    r = await guest.call("/studios?category=Podcast%20Lounge");
    check("category filter works", r.json?.data?.items?.length === 0);

    r = await guest.call("/studios?q=aurora");
    check("search finds by title", r.json?.data?.items?.length === 1);

    r = await guest.call(`/studios/${studioId}`);
    check("details returns studio + empty reviews", r.json?.data?.studio?._id === studioId
      && r.json?.data?.reviews?.length === 0);

    r = await guest.call("/studios/999000000000000000000000");
    check("unknown studio id → 404", r.status === 404);


    r = await A.call(`/studios/${studioId}/availability?date=${date}`);
    check("availability starts empty", r.json?.data?.slots?.length === 0);

    const C = new Session(); 
    r = await C.call("/auth/register", {
      method: "POST",
      body: { name: "Third Creator", email: "third@studiospace.dev", password: "Passw0rd" },
    });
    check("third account created", r.status === 201);

    r = await B.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "10:00", hours: 2 },
    });
    check("booking created → 201 Pending", r.status === 201
      && r.json?.data?.booking?.status === "Pending", JSON.stringify(r.json));
    check("total = rate × hours + deposit", r.json?.data?.booking?.total === 45 * 2 + 100);

    r = await B.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "11:00", hours: 1 },
    });
    check("overlapping booking → 409 (Challenge 2)", r.status === 409);

    r = await C.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "11:15", hours: 1 },
    });
    check("other user can't overlap a pending slot either", r.status === 409);

    r = await A.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "11:45", hours: 1 },
    });
    check("host cannot book own studio → 400", r.status === 400, JSON.stringify(r.json));

    r = await B.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "13:00", hours: 2 },
    });
    check("next free slot books fine", r.status === 201);
    check("endTime computed", r.json?.data?.booking?.endTime === "15:00");

    r = await B.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "23:00", hours: 2 },
    });
    check("over-midnight slot rejected", r.status === 400);

    r = await B.call("/bookings/mine");
    check("my bookings lists 2", r.json?.data?.items?.length === 2);

    const firstBookingId = r.json?.data?.items?.find((b) => b.startTime === "13:00")?._id;

    r = await guest.call("/bookings/mine");
    check("bookings/mine requires auth → 401", r.status === 401);


    r = await B.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "07:00", hours: 1 },
    });
    check("renter reserve slot → 201", r.status === 201);
    const bBookingId = r.json?.data?.booking?._id;

    r = await B.call(`/bookings/${bBookingId}/status`, {
      method: "PATCH",
      body: { status: "Confirmed" },
    });
    check("renter cannot confirm own booking → 403", r.status === 403, JSON.stringify(r.json));

    r = await B.call(`/bookings/${bBookingId}`, { method: "DELETE" });
    check("renter cancels own pending booking", r.status === 200, JSON.stringify(r.json));

    r = await A.call(`/studios/${studioId}/availability?date=${date}`);
    check("availability now shows taken slots", r.json?.data?.slots?.length === 2);


    r = await C.call(`/bookings/${firstBookingId}/status`, { method: "PATCH", body: { status: "Cancelled" } });
    check("outsider cannot touch a booking → 403", r.status === 403);

    r = await A.call(`/bookings/${firstBookingId}/status`, { method: "PATCH", body: { status: "Confirmed" } });
    check("host confirms booking (A owns studio)", r.status === 200
      && r.json?.data?.booking?.status === "Confirmed");

    r = await B.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "13:30", hours: 1 },
    });
    check("confirmed slot still blocks double-booking → 409", r.status === 409, JSON.stringify(r.json));

    r = await A.call(`/bookings/${firstBookingId}/status`, { method: "PATCH", body: { status: "Completed" } });
    check("confirmed → completed", r.status === 200 && r.json?.data?.booking?.status === "Completed");

    r = await A.call(`/bookings/${firstBookingId}/status`, { method: "PATCH", body: { status: "Pending" } });
    check("terminal state locked", r.status === 400);

    r = await A.call("/bookings/incoming");
    check("host sees incoming bookings (incl. cancelled trail)", r.json?.data?.items?.length === 3);

    r = await B.call("/bookings", {
      method: "POST",
      body: { studioId, date, startTime: "10:30", hours: 1 },
    });
    check("pending slot also blocks double-booking → 409", r.status === 409, JSON.stringify(r.json));


    r = await B.call("/wishlist", { method: "POST", body: { studioId } });
    check("wishlist save → added:true", r.json?.data?.added === true, JSON.stringify(r.json));

    r = await B.call("/wishlist");
    check("wishlist lists the studio", r.json?.data?.items?.length === 1);

    r = await B.call("/wishlist", { method: "POST", body: { studioId } });
    check("wishlist save is idempotent → added:false", r.json?.data?.added === false);

    r = await B.call(`/wishlist/${studioId}`, { method: "DELETE" });
    check("wishlist remove", r.status === 200 && r.json?.success === true);


    r = await B.call(`/studios/${studioId}/reviews`, {
      method: "POST",
      body: { rating: 5, comment: "The cyc wall alone is worth it — light was gorgeous." },
    });
    check("review posted", r.status === 200, JSON.stringify(r.json));

    r = await A.call(`/studios/${studioId}/reviews`, {
      method: "POST",
      body: { rating: 4, comment: "Hosts cannot review their own studio." },
    });
    check("host cannot review own studio", r.status === 403);

    r = await B.call(`/studios/${studioId}/reviews`, {
      method: "POST",
      body: { rating: 4, comment: "Updated my rating after the second visit — still great." },
    });
    check("duplicate review rejected → 409 (one per user)", r.status === 409);

    r = await guest.call(`/studios/${studioId}`);
    check("rating re-computed + count", r.json?.data?.studio?.rating === 5
      && r.json?.data?.studio?.reviewsCount === 1);


    r = await B.call(`/studios/${studioId}`, {
      method: "PUT",
      body: { ...studioInput, hourlyRate: 1 },
    });
    check("non-owner update → 403", r.status === 403);

    r = await A.call(`/studios/${studioId}`, {
      method: "PUT",
      body: { ...studioInput, title: "Aurora Photo Loft — Renovated" },
    });
    check("owner update → 200 + persisted", r.status === 200
      && r.json?.data?.studio?.title.includes("Renovated"));

    r = await B.call(`/studios/${studioId}`, { method: "DELETE" });
    check("non-owner delete → 403", r.status === 403);


    r = await A.call("/auth/logout", { method: "POST" });
    check("logout clears the cookie", r.status === 200);
    r = await A.call("/auth/me");
    check("me after logout → null user", r.json?.data?.user === null);
    A.clear();
  } catch (error) {
    failed++;
    failures.push(`harness: ${error.message}`);
    console.log(String(error));
    console.log("[smoke] ---- server output ----");
    console.log(serverLines.join(""));
  } finally {
    killTree(child);
    const killed = await Promise.race([
      new Promise((resolve) => child.on("exit", resolve)),
      sleep(4000).then(() => killTree(child)),
    ]);
    void killed;
    await mongod.stop();
  }

  console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("[smoke] failures:");
    for (const f of failures) console.log("   -", f);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[smoke] crashed:", error);
  process.exit(1);
});
