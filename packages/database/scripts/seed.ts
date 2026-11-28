/**
 * NUTS Commerce — Enterprise Database Seeder
 *
 * Populates PostgreSQL with realistic, referentially sound mock data:
 * - Admins, Users, UserWallets, ShippingAddresses, NotificationPreferences
 * - Vendors, VendorWallets, Categories (nested hierarchy with paths)
 * - Products, Variants, Cloudinary-hosted ProductImages, StockHistory
 * - Wishlists, Carts, Orders, OrderItems, OrderStatusHistory, Payments
 * - Reviews & Ratings (correlated with delivered purchases)
 * - DiscountCodes, Usages, Referrals, WalletTransactions
 * - Storefront Analytics, Funnel Events, Notifications, Outbox
 *
 * Usage:
 *   node --experimental-strip-types packages/database/scripts/seed.ts
 *   node --experimental-strip-types packages/database/scripts/seed.ts --tier=dev
 *   node --experimental-strip-types packages/database/scripts/seed.ts --tier=medium
 *   node --experimental-strip-types packages/database/scripts/seed.ts --tier=stress
 *   node --experimental-strip-types packages/database/scripts/seed.ts --clean
 */

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AnnouncementAudience,
  AnnouncementStatus,
  CategoryStatus,
  DiscountCodeScope,
  DiscountCodeType,
  NotificationPriority,
  NotificationType,
  OrderStatus,
  OutboxStatus,
  PaymentRefundStatus,
  PaymentStatus,
  PrismaClient,
  ROLE,
  WalletTransactionReason,
  WalletTransactionType,
} from "@prisma/client";

// All users, vendors, and admins share this pre-hashed bcrypt hash for 'Password123!'
// Pre-computing avoids burning minutes of CPU time hashing thousands of accounts.
const SHARED_BCRYPT_PASSWORD =
  "$2b$10$/e12I.LqP13WSPa3.LyHE.00kwuKOMsq1PHBc23StJJHbaDP7aDt2";

const CLOUDINARY_BASE =
  "https://res.cloudinary.com/vrbsxeht/image/upload/v1710000000/nuts-development";

// Curated Cloudinary product image sets by category
const CLOUDINARY_IMAGES = {
  electronics: [
    `${CLOUDINARY_BASE}/products/electronics-iphone15-pro.webp`,
    `${CLOUDINARY_BASE}/products/electronics-samsung-s24.webp`,
    `${CLOUDINARY_BASE}/products/electronics-macbook-pro.webp`,
    `${CLOUDINARY_BASE}/products/electronics-sony-wh1000xm5.webp`,
    `${CLOUDINARY_BASE}/products/electronics-ipad-air.webp`,
    `${CLOUDINARY_BASE}/products/electronics-galaxy-watch.webp`,
    `${CLOUDINARY_BASE}/products/electronics-mechanical-keyboard.webp`,
    `${CLOUDINARY_BASE}/products/electronics-4k-monitor.webp`,
  ],
  fashion: [
    `${CLOUDINARY_BASE}/products/fashion-leather-jacket.webp`,
    `${CLOUDINARY_BASE}/products/fashion-classic-sneakers.webp`,
    `${CLOUDINARY_BASE}/products/fashion-linen-shirt.webp`,
    `${CLOUDINARY_BASE}/products/fashion-wool-overcoat.webp`,
    `${CLOUDINARY_BASE}/products/fashion-leather-tote.webp`,
    `${CLOUDINARY_BASE}/products/fashion-denim-jeans.webp`,
    `${CLOUDINARY_BASE}/products/fashion-cotton-hoodie.webp`,
    `${CLOUDINARY_BASE}/products/fashion-sunglasses.webp`,
  ],
  home: [
    `${CLOUDINARY_BASE}/products/home-espresso-machine.webp`,
    `${CLOUDINARY_BASE}/products/home-air-fryer-pro.webp`,
    `${CLOUDINARY_BASE}/products/home-ergonomic-chair.webp`,
    `${CLOUDINARY_BASE}/products/home-ceramic-cookware.webp`,
    `${CLOUDINARY_BASE}/products/home-led-desk-lamp.webp`,
    `${CLOUDINARY_BASE}/products/home-blender.webp`,
    `${CLOUDINARY_BASE}/products/home-air-purifier.webp`,
  ],
  beauty: [
    `${CLOUDINARY_BASE}/products/beauty-vitamin-c-serum.webp`,
    `${CLOUDINARY_BASE}/products/beauty-artisan-perfume.webp`,
    `${CLOUDINARY_BASE}/products/beauty-beard-grooming-kit.webp`,
    `${CLOUDINARY_BASE}/products/beauty-hydrating-cleanser.webp`,
    `${CLOUDINARY_BASE}/products/beauty-sunscreen-spf50.webp`,
  ],
  groceries: [
    `${CLOUDINARY_BASE}/products/food-ethiopian-coffee-beans.webp`,
    `${CLOUDINARY_BASE}/products/food-roasted-cashews.webp`,
    `${CLOUDINARY_BASE}/products/food-ceremonial-matcha.webp`,
    `${CLOUDINARY_BASE}/products/food-extra-virgin-olive-oil.webp`,
    `${CLOUDINARY_BASE}/products/food-raw-organic-honey.webp`,
  ],
  sports: [
    `${CLOUDINARY_BASE}/products/sports-yoga-mat.webp`,
    `${CLOUDINARY_BASE}/products/sports-adjustable-dumbbells.webp`,
    `${CLOUDINARY_BASE}/products/sports-running-shoes.webp`,
    `${CLOUDINARY_BASE}/products/sports-smart-water-bottle.webp`,
  ],
  vendorLogos: [
    `${CLOUDINARY_BASE}/vendors/logo-techhaven.webp`,
    `${CLOUDINARY_BASE}/vendors/logo-urbanthreads.webp`,
    `${CLOUDINARY_BASE}/vendors/logo-livingclean.webp`,
    `${CLOUDINARY_BASE}/vendors/logo-soundpulse.webp`,
    `${CLOUDINARY_BASE}/vendors/logo-gourmetbites.webp`,
  ],
  avatars: [
    `${CLOUDINARY_BASE}/avatars/user-1.webp`,
    `${CLOUDINARY_BASE}/avatars/user-2.webp`,
    `${CLOUDINARY_BASE}/avatars/user-3.webp`,
    `${CLOUDINARY_BASE}/avatars/user-4.webp`,
  ],
};

// Seeding scale configurations
const TIERS = {
  dev: {
    users: 50,
    vendors: 12,
    products: 120,
    orders: 200,
    analyticsMultiplier: 5,
  },
  medium: {
    users: 300,
    vendors: 30,
    products: 800,
    orders: 1200,
    analyticsMultiplier: 15,
  },
  stress: {
    users: 1500,
    vendors: 80,
    products: 3500,
    orders: 6000,
    analyticsMultiplier: 50,
  },
};

const args = process.argv.slice(2);
const tierArg = (args.find((a) => a.startsWith("--tier="))?.split("=")[1] ||
  "dev") as keyof typeof TIERS;
const shouldClean = args.includes("--clean");
const config = TIERS[tierArg] || TIERS.dev;

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgrespassword@localhost:5433/nuts_dev?schema=public";

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function chunkedInsert<T>(
  label: string,
  items: T[],
  batchSize: number,
  insertFn: (batch: T[]) => Promise<unknown>
) {
  process.stdout.write(`  ⏳ ${label}: 0/${items.length}`);
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await insertFn(chunk);
    process.stdout.write(`\r  ⏳ ${label}: ${Math.min(i + batchSize, items.length)}/${items.length}`);
  }
  process.stdout.write(`\r  ✅ ${label}: ${items.length} inserted\n`);
}

async function cleanDatabase() {
  console.log("🧹 Truncating existing tables...");
  const tablenames = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
  `;

  for (const { tablename } of tablenames) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE;`
    );
  }
  console.log("✨ All tables cleaned successfully.\n");
}

async function main() {
  console.log("=================================================");
  console.log(`🚀 NUTS Commerce Database Seeder [Tier: ${tierArg.toUpperCase()}]`);
  console.log(`   Database URL: ${connectionString.replace(/:[^:@]+@/, ":****@")}`);
  console.log("=================================================\n");

  if (shouldClean) {
    await cleanDatabase();
  }

  // 1. Admins
  console.log("1️⃣ Seeding Platform Administrators...");
  const adminIds = [randomUUID(), randomUUID(), randomUUID()];
  await prisma.admin.createMany({
    data: [
      {
        id: adminIds[0],
        email: "admin@nuts.dev",
        password: SHARED_BCRYPT_PASSWORD,
        firstName: "Super",
        lastName: "Admin",
        role: ROLE.ADMIN,
        isActive: true,
      },
      {
        id: adminIds[1],
        email: "catalog.manager@nuts.dev",
        password: SHARED_BCRYPT_PASSWORD,
        firstName: "Catalog",
        lastName: "Manager",
        role: ROLE.ADMIN,
        isActive: true,
      },
      {
        id: adminIds[2],
        email: "operations@nuts.dev",
        password: SHARED_BCRYPT_PASSWORD,
        firstName: "Ops",
        lastName: "Supervisor",
        role: ROLE.ADMIN,
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  // 2. Categories
  console.log("2️⃣ Seeding Categories Tree...");
  const rootCategories = [
    { name: "Electronics", slug: "electronics", desc: "Computers, smartphones, audio & smart home gadgets", img: CLOUDINARY_IMAGES.electronics[0] },
    { name: "Fashion & Apparel", slug: "fashion", desc: "Premium clothing, footwear, accessories & jewelry", img: CLOUDINARY_IMAGES.fashion[0] },
    { name: "Home & Kitchen", slug: "home-kitchen", desc: "Appliances, ergonomic furniture & cookware", img: CLOUDINARY_IMAGES.home[0] },
    { name: "Beauty & Personal Care", slug: "beauty", desc: "Skincare, fragrance & grooming essentials", img: CLOUDINARY_IMAGES.beauty[0] },
    { name: "Groceries & Gourmet", slug: "groceries", desc: "Organic pantry, premium coffee & nuts", img: CLOUDINARY_IMAGES.groceries[0] },
    { name: "Sports & Outdoors", slug: "sports-outdoors", desc: "Fitness gear, athleisure & outdoor equipment", img: CLOUDINARY_IMAGES.sports[0] },
  ];

  const subCategoriesData: Record<string, string[]> = {
    electronics: ["Smartphones & Tablets", "Laptops & Computers", "Audio & Headphones", "Wearables & Smartwatches"],
    fashion: ["Men's Wear", "Women's Wear", "Footwear & Sneakers", "Bags & Accessories"],
    "home-kitchen": ["Kitchen Appliances", "Cookware & Dining", "Home Furniture", "Lighting & Decor"],
    beauty: ["Skincare", "Fragrance", "Hair & Grooming"],
    groceries: ["Coffee & Tea", "Nuts & Dried Fruits", "Cooking Oils & Spices"],
    "sports-outdoors": ["Gym & Fitness", "Running & Athletics", "Outdoor Accessories"],
  };

  const allCategories: Array<{ id: string; name: string; slug: string; parentId: string | null; path: string }> = [];

  for (let i = 0; i < rootCategories.length; i++) {
    const root = rootCategories[i];
    const rootId = randomUUID();
    allCategories.push({
      id: rootId,
      name: root.name,
      slug: root.slug,
      parentId: null,
      path: `/${root.slug}`,
    });

    await prisma.category.upsert({
      where: { slug: root.slug },
      update: {},
      create: {
        id: rootId,
        name: root.name,
        slug: root.slug,
        description: root.desc,
        imageUrl: root.img,
        sortOrder: i,
        status: CategoryStatus.ACTIVE,
        isActive: true,
        path: `/${root.slug}`,
      },
    });

    const subs = subCategoriesData[root.slug] || [];
    for (let j = 0; j < subs.length; j++) {
      const subName = subs[j];
      const subSlug = `${root.slug}-${subName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      const subId = randomUUID();
      const subPath = `/${root.slug}/${subSlug}`;
      allCategories.push({
        id: subId,
        name: subName,
        slug: subSlug,
        parentId: rootId,
        path: subPath,
      });

      await prisma.category.upsert({
        where: { slug: subSlug },
        update: {},
        create: {
          id: subId,
          name: subName,
          slug: subSlug,
          description: `${subName} under ${root.name}`,
          parentId: rootId,
          sortOrder: j,
          status: CategoryStatus.ACTIVE,
          isActive: true,
          path: subPath,
        },
      });
    }
  }

  // 3. Vendors & Wallets
  console.log(`3️⃣ Seeding ${config.vendors} Vendors & Vendor Wallets...`);
  const vendorTemplates = [
    { name: "TechHaven Global", slug: "techhaven", desc: "Direct importer of flagship mobile devices, computing, and high-fidelity sound." },
    { name: "Urban Threads Studio", slug: "urbanthreads", desc: "Contemporary streetwear, tailored minimal apparel, and handcrafted leather footwear." },
    { name: "LivingClean Homegoods", slug: "livingclean", desc: "Sustainable kitchen appliances, organic cotton essentials, and designer lighting." },
    { name: "Aura Botanicals", slug: "aurabotanicals", desc: "Cruelty-free botanical skincare, cold-pressed serums, and clean fragrances." },
    { name: "Heritage Roasters & Spices", slug: "heritageroasters", desc: "Direct-trade single-origin coffees, organic roasted nuts, and gourmet pantry goods." },
    { name: "Velocity Sports Performance", slug: "velocitysports", desc: "Pro-tier training gear, compression athletic wear, and smart biometric sensors." },
    { name: "SoundPulse Audio", slug: "soundpulse", desc: "Audiophile studio monitors, lossless wireless earbuds, and acoustic accessories." },
    { name: "Moda Italia Essentials", slug: "modaitalia", desc: "Classic Italian leathercraft, luxury outerwear, and timeless accessories." },
  ];

  const vendorRecords: Array<{ id: string; storeName: string; storeSlug: string; email: string }> = [];
  const vendorWalletRecords: Array<{ id: string; vendorId: string; balance: number; pendingBalance: number; lifetimeEarnings: number }> = [];

  for (let i = 0; i < config.vendors; i++) {
    const template = vendorTemplates[i % vendorTemplates.length];
    const suffix = i >= vendorTemplates.length ? `-${Math.floor(i / vendorTemplates.length) + 1}` : "";
    const vendorId = randomUUID();
    const storeSlug = `${template.slug}${suffix}`;
    const email = `vendor${i + 1}@nuts.dev`;
    const logoUrl = CLOUDINARY_IMAGES.vendorLogos[i % CLOUDINARY_IMAGES.vendorLogos.length];

    vendorRecords.push({ id: vendorId, storeName: `${template.name}${suffix ? ` #${i + 1}` : ""}`, storeSlug, email });
    vendorWalletRecords.push({
      id: randomUUID(),
      vendorId,
      balance: Math.floor(Math.random() * 500000) + 15000,
      pendingBalance: Math.floor(Math.random() * 80000) + 5000,
      lifetimeEarnings: Math.floor(Math.random() * 2500000) + 200000,
    });

    await prisma.vendor.upsert({
      where: { storeSlug },
      update: {},
      create: {
        id: vendorId,
        email,
        password: SHARED_BCRYPT_PASSWORD,
        storeName: `${template.name}${suffix ? ` #${i + 1}` : ""}`,
        storeSlug,
        storeDescription: template.desc,
        businessEmail: email,
        businessPhone: `+23480${Math.floor(10000000 + Math.random() * 90000000)}`,
        storeLogoUrl: logoUrl,
        storeLogoAltText: `${template.name} official store logo`,
        isVerified: true,
        isActive: true,
        isApproved: true,
        firstName: "Vendor",
        lastName: `Owner ${i + 1}`,
      },
    });

    await prisma.vendorWallet.upsert({
      where: { vendorId },
      update: {},
      create: vendorWalletRecords[i],
    });
  }

  // 4. Shopper Users, Wallets, Addresses & Preferences
  console.log(`4️⃣ Seeding ${config.users} Customer Accounts, Wallets & Addresses...`);
  const userRecords: Array<{ id: string; email: string; firstName: string; lastName: string }> = [];
  const userWallets: Array<{ id: string; userId: string; balance: number }> = [];
  const addresses: Array<{ id: string; userId: string; fullName: string; phone: string; street: string; city: string; state: string; isDefault: boolean }> = [];
  const preferences: Array<{ id: string; userId: string; role: ROLE }> = [];
  const referralCodes: Array<{ id: string; code: string; userId: string }> = [];

  const nigerianCities = [
    { city: "Lagos", state: "Lagos", street: "14 Admiralty Way, Lekki Phase 1" },
    { city: "Ikeja", state: "Lagos", street: "42 Isaac John Street, GRA" },
    { city: "Abuja", state: "FCT", street: "12 Gana Street, Maitama" },
    { city: "Port Harcourt", state: "Rivers", street: "8 Old GRA Extension" },
    { city: "Ibadan", state: "Oyo", street: "25 Ring Road, Bodija" },
    { city: "Enugu", state: "Enugu", street: "18 Independence Avenue" },
  ];

  for (let i = 0; i < config.users; i++) {
    const userId = randomUUID();
    const email = `shopper${i + 1}@nuts.dev`;
    const firstName = ["Chidi", "Amaka", "Tunde", "Zainab", "Emeka", "Fatima", "Oluwaseun", "Ngozi", "Ibrahim", "Blessing"][i % 10];
    const lastName = ["Okonkwo", "Adeyemi", "Bello", "Eze", "Danjuma", "Nwosu", "Balogun", "Suleiman", "Okafor", "Aliyu"][i % 10];
    const avatar = CLOUDINARY_IMAGES.avatars[i % CLOUDINARY_IMAGES.avatars.length];
    const loc = nigerianCities[i % nigerianCities.length];

    userRecords.push({ id: userId, email, firstName, lastName });
    userWallets.push({ id: randomUUID(), userId, balance: Math.floor(Math.random() * 50000) });
    addresses.push({
      id: randomUUID(),
      userId,
      fullName: `${firstName} ${lastName}`,
      phone: `+23481${Math.floor(10000000 + Math.random() * 90000000)}`,
      street: loc.street,
      city: loc.city,
      state: loc.state,
      isDefault: true,
    });
    preferences.push({ id: randomUUID(), userId, role: ROLE.USER });
    referralCodes.push({ id: randomUUID(), code: `NUTS-${firstName.toUpperCase().slice(0, 4)}${i + 10}`, userId });
  }

  await chunkedInsert("Users", userRecords, 200, async (batch) => {
    await prisma.user.createMany({
      data: batch.map((u) => ({
        id: u.id,
        email: u.email,
        password: SHARED_BCRYPT_PASSWORD,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: `+23480${Math.floor(10000000 + Math.random() * 90000000)}`,
        role: ROLE.USER,
        isActive: true,
        isEmailVerified: true,
        avatarUrl: CLOUDINARY_IMAGES.avatars[0],
      })),
      skipDuplicates: true,
    });
  });

  await chunkedInsert("User Wallets", userWallets, 200, async (batch) => {
    await prisma.userWallet.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Shipping Addresses", addresses, 200, async (batch) => {
    await prisma.shippingAddress.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Notification Preferences", preferences, 200, async (batch) => {
    await prisma.notificationPreference.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Referral Codes", referralCodes, 200, async (batch) => {
    await prisma.referralCode.createMany({ data: batch, skipDuplicates: true });
  });

  // 5. Products, Variants & Cloudinary Images
  console.log(`5️⃣ Seeding ${config.products} Products with Cloudinary Images & Variants...`);
  const productCatalogue = [
    { name: "Pro Studio Wireless Noise-Cancelling Headphones", cat: "electronics", price: 185000, hasVar: true },
    { name: "UltraSlim 14-inch OLED Laptop 32GB RAM", cat: "electronics", price: 1250000, hasVar: true },
    { name: "Titanium Mechanical Chronograph Smartwatch", cat: "electronics", price: 320000, hasVar: true },
    { name: "Full-Frame 4K Mirrorless Cinema Camera", cat: "electronics", price: 1950000, hasVar: false },
    { name: "True Wireless Earbuds with Spatial Audio", cat: "electronics", price: 75000, hasVar: true },
    { name: "Heritage Italian Leather Biker Jacket", cat: "fashion", price: 145000, hasVar: true },
    { name: "Minimalist Low-Top Suede Sneakers", cat: "fashion", price: 68000, hasVar: true },
    { name: "Pure Belgian Linen Button-Down Shirt", cat: "fashion", price: 42000, hasVar: true },
    { name: "Cashmere-Wool Blend Winter Trench Coat", cat: "fashion", price: 210000, hasVar: true },
    { name: "Vegetable-Tanned Daily Leather Tote", cat: "fashion", price: 95000, hasVar: false },
    { name: "Commercial Dual-Boiler Espresso Machine", cat: "home-kitchen", price: 480000, hasVar: false },
    { name: "Smart Rapid Multi-Zone Air Fryer 8L", cat: "home-kitchen", price: 125000, hasVar: true },
    { name: "Ergonomic Lumbar Executive Task Chair", cat: "home-kitchen", price: 240000, hasVar: true },
    { name: "Non-Toxic Ceramic 10-Piece Cookware Set", cat: "home-kitchen", price: 165000, hasVar: true },
    { name: "Cold-Pressed Antioxidant Vitamin C Glow Serum", cat: "beauty", price: 28000, hasVar: false },
    { name: "Artisanal Cedarwood & Bergamot Eau de Parfum", cat: "beauty", price: 85000, hasVar: true },
    { name: "Precision Barber Cordless Beard Trimmer Kit", cat: "beauty", price: 45000, hasVar: false },
    { name: "Single-Origin Yirgacheffe Whole Coffee Beans 1kg", cat: "groceries", price: 24000, hasVar: true },
    { name: "Slow-Roasted Honey Glazed Jumbo Cashews 500g", cat: "groceries", price: 18000, hasVar: false },
    { name: "First-Harvest Ceremonial Grade Japanese Matcha", cat: "groceries", price: 32000, hasVar: false },
    { name: "High-Density Non-Slip Natural Rubber Yoga Mat", cat: "sports-outdoors", price: 38000, hasVar: true },
    { name: "Rapid-Lock Quick-Adjust Dumbbell Set 32kg", cat: "sports-outdoors", price: 290000, hasVar: false },
  ];

  const productRecords: Array<{
    id: string;
    name: string;
    slug: string;
    sku: string;
    description: string;
    price: number;
    stock: number;
    hasVariants: boolean;
    categoryId: string;
    vendorId: string;
    isActive: boolean;
  }> = [];

  const productImageRecords: Array<{
    id: string;
    productId: string;
    url: string;
    altText: string;
    position: number;
    isPrimary: boolean;
  }> = [];

  const variantRecords: Array<{
    id: string;
    productId: string;
    options: object;
    optionsKey: string;
    stock: number;
    images: string[];
    isActive: boolean;
  }> = [];

  for (let i = 0; i < config.products; i++) {
    const item = productCatalogue[i % productCatalogue.length];
    const vendor = vendorRecords[i % vendorRecords.length];
    const category = allCategories.find((c) => c.slug.startsWith(item.cat)) || allCategories[0];
    const productId = randomUUID();
    const suffix = i >= productCatalogue.length ? `-${Math.floor(i / productCatalogue.length) + 1}` : "";
    const baseSlug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const slug = `${baseSlug}${suffix}`;
    const sku = `NUTS-${item.cat.toUpperCase().slice(0, 3)}-${String(i + 1).padStart(5, "0")}`;
    const stock = Math.floor(Math.random() * 80) + 10;
    const catImages = CLOUDINARY_IMAGES[item.cat as keyof typeof CLOUDINARY_IMAGES] || CLOUDINARY_IMAGES.electronics;

    productRecords.push({
      id: productId,
      name: `${item.name}${suffix ? ` (Edition ${i + 1})` : ""}`,
      slug,
      sku,
      description: `Experience exceptional craftsmanship and performance with the ${item.name}. Authentically sourced and backed by our comprehensive warranty and satisfaction guarantee.`,
      price: item.price,
      stock,
      hasVariants: item.hasVar,
      categoryId: category.id,
      vendorId: vendor.id,
      isActive: true,
    });

    // 1-3 Cloudinary Product Images
    const primaryImg = catImages[i % catImages.length];
    productImageRecords.push({
      id: randomUUID(),
      productId,
      url: primaryImg,
      altText: `${item.name} primary product shot`,
      position: 0,
      isPrimary: true,
    });

    const secondaryImg = catImages[(i + 1) % catImages.length];
    productImageRecords.push({
      id: randomUUID(),
      productId,
      url: secondaryImg,
      altText: `${item.name} lifestyle presentation`,
      position: 1,
      isPrimary: false,
    });

    // Product Variants if applicable
    if (item.hasVar) {
      const colors = ["Obsidian Black", "Arctic Silver", "Midnight Navy"];
      const sizes = item.cat === "fashion" ? ["Small", "Medium", "Large"] : ["Standard", "Pro Upgrade"];

      for (const color of colors) {
        for (const size of sizes) {
          const varOptions = [
            { name: "Color", value: color },
            { name: "Size", value: size },
          ];
          const optionsKey = `color:${color.toLowerCase().replace(/\s+/g, "-")}|size:${size.toLowerCase().replace(/\s+/g, "-")}`;

          variantRecords.push({
            id: randomUUID(),
            productId,
            options: varOptions,
            optionsKey,
            stock: Math.floor(Math.random() * 25) + 3,
            images: [primaryImg, secondaryImg],
            isActive: true,
          });
        }
      }
    }
  }

  await chunkedInsert("Products", productRecords, 200, async (batch) => {
    await prisma.product.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Cloudinary Product Images", productImageRecords, 500, async (batch) => {
    await prisma.productImage.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Product Variants", variantRecords, 500, async (batch) => {
    await prisma.productVariant.createMany({ data: batch, skipDuplicates: true });
  });

  // 6. Orders, Order Items, Status History & Payments
  console.log(`6️⃣ Seeding ${config.orders} Orders, Items & Payments...`);
  const orderRecords: Array<{
    id: string;
    orderNumber: string;
    status: OrderStatus;
    totalAmount: number;
    finalAmount: number;
    userId: string;
    shippingAddress: string;
    createdAt: Date;
  }> = [];

  const orderItemRecords: Array<{
    id: string;
    orderId: string;
    productId: string;
    vendorId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    productSnapshot: object;
  }> = [];

  const paymentRecords: Array<{
    id: string;
    orderId: string;
    userId: string;
    amount: number;
    status: PaymentStatus;
    paymentMethod: string;
    transactionReference: string;
    createdAt: Date;
  }> = [];

  const orderHistoryRecords: Array<{
    id: string;
    orderId: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    note: string;
    changedByUserId: string;
    createdAt: Date;
  }> = [];

  const statuses: OrderStatus[] = [
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERED,
    OrderStatus.SHIPPED,
    OrderStatus.PROCESSING,
    OrderStatus.PENDING,
    OrderStatus.CANCELLED,
  ];

  for (let i = 0; i < config.orders; i++) {
    const orderId = randomUUID();
    const user = userRecords[i % userRecords.length];
    const status = statuses[i % statuses.length];
    const orderNumber = `NUTS-ORD-${String(i + 10001)}`;
    const product = productRecords[i % productRecords.length];
    const qty = (i % 3) + 1;
    const total = product.price * qty;
    const dateOffsetDays = Math.floor(Math.random() * 60);
    const orderDate = new Date(Date.now() - dateOffsetDays * 86400000);

    orderRecords.push({
      id: orderId,
      orderNumber,
      status,
      totalAmount: total,
      finalAmount: total,
      userId: user.id,
      shippingAddress: addresses[i % addresses.length].street,
      createdAt: orderDate,
    });

    orderItemRecords.push({
      id: randomUUID(),
      orderId,
      productId: product.id,
      vendorId: product.vendorId,
      quantity: qty,
      unitPrice: product.price,
      totalPrice: total,
      productSnapshot: { name: product.name, sku: product.sku, price: product.price },
    });

    paymentRecords.push({
      id: randomUUID(),
      orderId,
      userId: user.id,
      amount: total,
      status: status === OrderStatus.CANCELLED ? PaymentStatus.REFUNDED : PaymentStatus.SUCCESS,
      paymentMethod: i % 2 === 0 ? "card" : "wallet",
      transactionReference: `PAY-REF-${orderNumber}`,
      createdAt: orderDate,
    });

    orderHistoryRecords.push({
      id: randomUUID(),
      orderId,
      fromStatus: null,
      toStatus: status,
      note: `Order initialized and moved to ${status}`,
      changedByUserId: user.id,
      createdAt: orderDate,
    });
  }

  await chunkedInsert("Orders", orderRecords, 200, async (batch) => {
    await prisma.order.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Order Items", orderItemRecords, 500, async (batch) => {
    await prisma.orderItem.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Payments", paymentRecords, 500, async (batch) => {
    await prisma.payment.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Order Status History", orderHistoryRecords, 500, async (batch) => {
    await prisma.orderStatusHistory.createMany({ data: batch, skipDuplicates: true });
  });

  // 7. Reviews & Ratings (correlated with delivered orders)
  console.log("7️⃣ Seeding Verified Customer Reviews & Comments...");
  const reviewComments = [
    "Absolutely exceeded my expectations! The quality of materials and packaging was top notch.",
    "Very fast delivery to Lagos. Works exactly as described, highly recommend this vendor.",
    "Good product overall. Sturdy build, looks premium, arrived in 24 hours.",
    "Satisfied with this purchase. Customer service from the seller was prompt and courteous.",
    "Super clean aesthetic and seamless setup. 5 stars without hesitation!",
    "Decent quality for the price point. Packaging could be slightly firmer but product is safe.",
    "One of the best purchases I have made on NUTS this year. Will definitely order again.",
  ];

  const reviewRecords: Array<{
    id: string;
    userId: string;
    productId: string;
    rating: number;
    comment: string;
    isActive: boolean;
  }> = [];

  const uniqueUserProductPairs = new Set<string>();

  for (const item of orderItemRecords) {
    const order = orderRecords.find((o) => o.id === item.orderId);
    if (!order || order.status !== OrderStatus.DELIVERED) continue;

    const pairKey = `${order.userId}:${item.productId}`;
    if (uniqueUserProductPairs.has(pairKey)) continue;
    uniqueUserProductPairs.add(pairKey);

    const rating = Math.random() > 0.3 ? (Math.random() > 0.5 ? 5 : 4) : 3;
    reviewRecords.push({
      id: randomUUID(),
      userId: order.userId,
      productId: item.productId,
      rating,
      comment: reviewComments[reviewRecords.length % reviewComments.length],
      isActive: true,
    });
  }

  await chunkedInsert("Verified Reviews", reviewRecords, 300, async (batch) => {
    await prisma.review.createMany({ data: batch, skipDuplicates: true });
  });

  // 8. Wishlists & Vendor Follows
  console.log("8️⃣ Seeding Wishlists & Store Follows...");
  const wishlistRecords: Array<{ id: string; userId: string; productId: string }> = [];
  const followRecords: Array<{ id: string; userId: string; vendorId: string }> = [];
  const uniqueWishlist = new Set<string>();
  const uniqueFollows = new Set<string>();

  for (let i = 0; i < userRecords.length; i++) {
    const user = userRecords[i];
    // Each user saves 1-3 products
    for (let k = 0; k < 2; k++) {
      const prod = productRecords[(i * 2 + k) % productRecords.length];
      const wKey = `${user.id}:${prod.id}`;
      if (!uniqueWishlist.has(wKey)) {
        uniqueWishlist.add(wKey);
        wishlistRecords.push({ id: randomUUID(), userId: user.id, productId: prod.id });
      }
    }
    // Each user follows 1 vendor
    const v = vendorRecords[i % vendorRecords.length];
    const fKey = `${user.id}:${v.id}`;
    if (!uniqueFollows.has(fKey)) {
      uniqueFollows.add(fKey);
      followRecords.push({ id: randomUUID(), userId: user.id, vendorId: v.id });
    }
  }

  await chunkedInsert("Wishlist Items", wishlistRecords, 500, async (batch) => {
    await prisma.wishlistItem.createMany({ data: batch, skipDuplicates: true });
  });

  await chunkedInsert("Vendor Follows", followRecords, 500, async (batch) => {
    await prisma.vendorFollow.createMany({ data: batch, skipDuplicates: true });
  });

  // 9. Discount Codes & Wallet Transactions
  console.log("9️⃣ Seeding Discounts & Financial Audit Records...");
  await prisma.discountCode.createMany({
    data: [
      {
        id: randomUUID(),
        code: "FREESHIP50K",
        description: "Flat discount to subsidize local logistics",
        type: DiscountCodeType.FIXED,
        value: 3500,
        minOrderAmount: 40000,
        scope: DiscountCodeScope.PLATFORM,
        platformwide: true,
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  const walletTxRecords: Array<{
    id: string;
    vendorWalletId: string;
    amount: number;
    type: WalletTransactionType;
    reason: WalletTransactionReason;
    referenceId: string;
  }> = [];

  for (let i = 0; i < vendorWalletRecords.length; i++) {
    const vw = vendorWalletRecords[i];
    walletTxRecords.push({
      id: randomUUID(),
      vendorWalletId: vw.id,
      amount: Math.floor(Math.random() * 80000) + 10000,
      type: WalletTransactionType.CREDIT,
      reason: WalletTransactionReason.SALE,
      referenceId: `TX-SALE-${String(i + 1001)}`,
    });
  }

  await chunkedInsert("Wallet Transactions", walletTxRecords, 500, async (batch) => {
    await prisma.walletTransaction.createMany({ data: batch, skipDuplicates: true });
  });

  // 10. Storefront Analytics & Funnel Events
  console.log("🔟 Seeding Storefront Analytics & Funnel Impressions...");
  const searchQueries = [
    "wireless headphones", "oled laptop", "leather jacket", "sneakers", "espresso machine",
    "smartwatch", "air fryer", "vitamin c serum", "coffee beans", "hoodie", "task chair",
  ];

  const searchRecords = searchQueries.map((q, idx) => ({
    id: randomUUID(),
    query: q,
    resultsCount: Math.floor(Math.random() * 20) + 4,
    userId: userRecords[idx % userRecords.length].id,
  }));

  await prisma.searchQuery.createMany({ data: searchRecords, skipDuplicates: true });

  const eventCount = Math.min(config.products * config.analyticsMultiplier, 15000);
  const marketplaceEvents: Array<{
    id: string;
    eventType: string;
    productId: string;
    vendorId: string;
    userId: string;
    surface: string;
    createdAt: Date;
  }> = [];

  const eventTypes = ["PRODUCT_VIEW", "ADD_TO_CART", "CHECKOUT_START", "PURCHASE"];

  for (let i = 0; i < eventCount; i++) {
    const prod = productRecords[i % productRecords.length];
    const user = userRecords[i % userRecords.length];
    const eventType = eventTypes[i % eventTypes.length];
    const dateOffset = Math.floor(Math.random() * 30);

    marketplaceEvents.push({
      id: randomUUID(),
      eventType,
      productId: prod.id,
      vendorId: prod.vendorId,
      userId: user.id,
      surface: "storefront_feed",
      createdAt: new Date(Date.now() - dateOffset * 86400000),
    });
  }

  await chunkedInsert("Shopper activity", marketplaceEvents, 1000, async (batch) => {
    await prisma.shopperActivity.createMany({ data: batch });
  });

  // 11. System Announcements & User Notifications
  console.log("1️⃣1️⃣ Seeding Announcements & Notifications...");
  await prisma.announcement.createMany({
    data: [
      {
        id: randomUUID(),
        title: "Platform Upgrade: Instant Delivery & Cloudinary CDN",
        message: "We have upgraded our image delivery pipeline to high-speed Cloudinary edge CDN and expanded local 24hr delivery guarantees.",
        audience: AnnouncementAudience.CUSTOMERS,
        priority: NotificationPriority.HIGH,
        status: AnnouncementStatus.PUBLISHED,
        publishedAt: new Date(),
        recipientCount: config.users,
      },
      {
        id: randomUUID(),
        title: "Vendor Payout System Update",
        message: "Automated wallet settlements now process every Monday and Thursday morning directly to verified bank accounts.",
        audience: AnnouncementAudience.VENDORS,
        priority: NotificationPriority.MEDIUM,
        status: AnnouncementStatus.PUBLISHED,
        publishedAt: new Date(),
        recipientCount: config.vendors,
      },
    ],
    skipDuplicates: true,
  });

  const notifications: Array<{
    id: string;
    userId: string;
    role: ROLE;
    type: NotificationType;
    title: string;
    message: string;
    priority: NotificationPriority;
    isRead: boolean;
  }> = [];

  for (let i = 0; i < userRecords.length; i++) {
    const user = userRecords[i];
    notifications.push(
      {
        id: randomUUID(),
        userId: user.id,
        role: ROLE.USER,
        type: NotificationType.ORDER_DELIVERED,
        title: "Your order has arrived!",
        message: "Package successfully delivered. Please confirm receipt and leave a review.",
        priority: NotificationPriority.MEDIUM,
        isRead: false,
      },
      {
        id: randomUUID(),
        userId: user.id,
        role: ROLE.USER,
        type: NotificationType.PRICE_DROP,
        title: "Price drop on an item in your wishlist",
        message: "A saved product just discounted by 15% for the weekend sale.",
        priority: NotificationPriority.LOW,
        isRead: true,
      }
    );
  }

  await chunkedInsert("In-App Notifications", notifications, 500, async (batch) => {
    await prisma.notification.createMany({ data: batch, skipDuplicates: true });
  });

  console.log("\n=================================================");
  console.log("🎉 DATABASE SEEDING COMPLETED SUCCESSFULLY!");
  console.log("=================================================");
  console.log("Default Test Credentials:");
  console.log("  • Admin:   admin@nuts.dev       (Password: Password123!)");
  console.log("  • Vendor:  vendor1@nuts.dev     (Password: Password123!)");
  console.log("  • Shopper: shopper1@nuts.dev    (Password: Password123!)");
  console.log("=================================================\n");
}

main()
  .catch((err) => {
    console.error("❌ Seeding failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
