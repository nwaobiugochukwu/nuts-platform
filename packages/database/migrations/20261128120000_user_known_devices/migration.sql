-- The browsers and systems each customer has signed in from, so a sign-in from a new one can
-- trigger a security email. One row per (customer, device hash); the hash covers the browser and
-- the operating system only, never the IP address.
CREATE TABLE "user_known_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "last_ip" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_known_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_known_devices_user_id_device_hash_key" ON "user_known_devices"("user_id", "device_hash");

ALTER TABLE "user_known_devices" ADD CONSTRAINT "user_known_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
