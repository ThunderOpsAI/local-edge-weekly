import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }

  return process.argv[index + 1] ?? fallback;
}

function isoForWeek(weeksAgo, hour = 9) {
  const date = new Date();
  date.setUTCHours(hour, 15, 0, 0);
  date.setUTCDate(date.getUTCDate() - weeksAgo * 7);
  return date.toISOString();
}

function isoWeekLabel(value) {
  const date = new Date(value);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function inferMoveType(story) {
  const text = `${story.gap} ${story.hook} ${story.deltas.map((delta) => delta[1]).join(" ")}`.toLowerCase();
  if (/late|9pm|night/.test(text)) {
    return "extend_late_night";
  }
  if (/lunch|office|worker/.test(text)) {
    return "win_lunch";
  }
  if (/bundle|combo|box|pack|group|share/.test(text)) {
    return "launch_bundle";
  }
  if (/limited|three days|deadline|this week/.test(text)) {
    return "test_limited_offer";
  }
  if (/free delivery|discount|value/.test(text)) {
    return "defend_value";
  }
  if (/sauce|flavour|flavor|signature|crispy|boneless/.test(text)) {
    return "highlight_signature";
  }
  return "hold_position";
}

function moveTitle(moveType) {
  return {
    launch_bundle: "Launch a named bundle this week",
    defend_value: "Defend value without copying the discount",
    win_lunch: "Win the office lunch window",
    extend_late_night: "Extend the late-night offer",
    push_group_order: "Push the group order",
    highlight_signature: "Make the signature item louder",
    test_limited_offer: "Test a short limited offer",
    hold_position: "Hold position and keep watching",
  }[moveType] ?? "Hold position and keep watching";
}

function pressureTypeFromText(text) {
  const lower = text.toLowerCase();
  if (/late|9pm|night/.test(lower)) {
    return "late_night_pressure";
  }
  if (/lunch|office|student/.test(lower)) {
    return "lunch_office_pressure";
  }
  if (/bundle|combo|box|pack|group|share|family/.test(lower)) {
    return "bundle_pressure";
  }
  if (/limited|special|free|deadline|new/.test(lower)) {
    return "urgency_offer_pressure";
  }
  if (/delivery|deal|value|price|minimum spend/.test(lower)) {
    return "delivery_value_pressure";
  }
  return "differentiation_pressure";
}

function buildDecisionPack(story, timestamp) {
  const primaryMoveType = inferMoveType(story);
  const secondaryMoveType = primaryMoveType === "launch_bundle" ? "win_lunch" : "launch_bundle";
  const evidenceItems = story.deltas.slice(0, 4).map(([competitor, summary], index) => ({
    competitor,
    signal_type: "demo_competitor_movement",
    week: isoWeekLabel(timestamp),
    source: summary.includes("Reddit") ? "reddit" : summary.includes("wording") || summary.includes("language") ? "competitor_url" : "google_maps",
    summary,
    demo_flag: true,
    rank: index + 1,
  }));
  const pressureSummary = story.deltas.slice(0, 4).map(([competitor, summary, impact]) => ({
    type: pressureTypeFromText(summary),
    level: impact >= 8 ? "high" : impact >= 6 ? "medium" : "low",
    score: impact,
    competitors: [{ competitor, score: impact }],
  }));
  const snapshotCandidates = story.deltas
    .filter(([, summary, impact]) => impact >= 7 && /wording|language|website|bundle|delivery|lunch|late|box|pack/i.test(summary))
    .slice(0, 2)
    .map(([competitor, summary, impact]) => {
      const target = targets.find((item) => item.name === competitor);
      return {
        competitor,
        url: target?.url ?? null,
        trigger_score: impact,
        current_image_url: null,
        previous_image_url: null,
        diff_summary: summary,
        capture_note: "Demo snapshot metadata. Screenshot capture is wired as optional storage metadata.",
        demo_flag: true,
      };
    });

  return {
    week_label: isoWeekLabel(timestamp),
    primary_move: {
      type: primaryMoveType,
      title: moveTitle(primaryMoveType),
      score: 0.86,
    },
    secondary_move: {
      type: secondaryMoveType,
      title: moveTitle(secondaryMoveType),
      score: 0.62,
    },
    pressure_summary: pressureSummary,
    why_now: story.gap,
    evidence_items: evidenceItems,
    expected_effect: "Best hypothesis: give Seoul Crunch one memorable offer that answers the strongest competitor pressure without over-discounting.",
    confidence_score: Math.max(72, Math.min(92, story.deltas[0]?.[2] ? story.deltas[0][2] * 10 : 82)),
    execution_assets: {
      owner_brief: story.hook,
      staff_brief: "Use the same offer name at the counter, in delivery copy, and in any customer replies this week.",
      promo_lines: [
        "One clear move for this week.",
        "Built for the CBD rush.",
        "Order it before the next competitor move.",
      ],
      sms_caption: story.hook,
      delivery_description: story.hook,
    },
    watch_next_week: [
      "Check whether Gami escalates or holds its offer language.",
      "Check whether Sam Sam repeats the same bundle or lunch cue.",
      "Watch Reddit for competitor praise where Seoul Crunch is absent.",
    ],
    source_flags: {
      demo_flag: true,
      sources_fired: ["google_reviews", "reddit", "website_delta"],
      snapshot_candidates: snapshotCandidates,
    },
  };
}

const targets = [
  {
    key: "target",
    name: "Seoul Crunch CBD (Demo)",
    url: "https://example.com/seoul-crunch-cbd",
    role: "primary",
    isPrimary: true,
    placeId: "demo-seoul-crunch-cbd",
    baseRating: 4.4,
    baseReviews: 312,
    websiteKeywords: ["order online", "boneless chicken", "delivery", "lunch combo"],
  },
  {
    key: "gami",
    name: "Gami Chicken & Beer CBD",
    url: "https://www.gamichicken.com.au/location/",
    role: "competitor",
    isPrimary: false,
    placeId: "demo-gami-cbd",
    baseRating: 4.2,
    baseReviews: 1420,
    websiteKeywords: ["delivery", "order online", "beer", "boneless", "group meals"],
  },
  {
    key: "samsam",
    name: "Sam Sam Chicken CBD",
    url: "https://www.samsamchicken.com/locations",
    role: "competitor",
    isPrimary: false,
    placeId: "demo-samsam-cbd",
    baseRating: 4.5,
    baseReviews: 1186,
    websiteKeywords: ["delivery", "lunch special", "combo", "crispy chicken", "late night"],
  },
  {
    key: "buza",
    name: "Buza Chicken CBD",
    url: "https://www.buzachicken.com.au/stores",
    role: "competitor",
    isPrimary: false,
    placeId: "demo-buza-cbd",
    baseRating: 4.3,
    baseReviews: 948,
    websiteKeywords: ["delivery", "fried chicken", "soju", "beer", "book now"],
  },
];

const weeklyStories = [
  {
    weeksAgo: 11,
    coverage: 0.76,
    sourceSuccess: 8,
    sourceFail: 2,
    marketStatus: "Growth",
    reviewGrowth: { target: 0, gami: 0, samsam: 0, buza: 0 },
    keywordAdds: {
      target: [],
      gami: ["order online"],
      samsam: ["lunch special"],
      buza: [],
    },
    redditPosts: { target: 1, gami: 2, samsam: 2, buza: 1 },
    gap: "The CBD delivery market already looks promo-led: competitors are talking about lunch specials and order-online paths while Seoul Crunch is still leaning on menu basics.",
    hook: "Launch the first simple owner move: a weekday lunch combo that is visible on the website and delivery profiles by 11am.",
    deltas: [
      ["Sam Sam Chicken CBD", "Lunch-special language appeared in the market, creating pressure around weekday office orders.", 7],
      ["Gami Chicken & Beer CBD", "Order-online wording is visible, making the conversion path clearer than a generic menu page.", 6],
      ["Buza Chicken CBD", "Beer and dine-in cues remain present, but delivery-specific urgency is still weaker.", 4],
    ],
  },
  {
    weeksAgo: 10,
    coverage: 0.82,
    sourceSuccess: 9,
    sourceFail: 1,
    marketStatus: "Growth",
    reviewGrowth: { target: 7, gami: 14, samsam: 12, buza: 9 },
    keywordAdds: {
      target: ["lunch combo"],
      gami: ["group meals"],
      samsam: ["combo"],
      buza: ["book now"],
    },
    redditPosts: { target: 1, gami: 2, samsam: 3, buza: 1 },
    gap: "Competitors are moving from menu visibility into bundles: group meals, combos, and clearer booking calls-to-action.",
    hook: "Make Seoul Crunch's lunch combo more specific: two-piece chicken, chips, drink, and a price anchor before the lunch rush.",
    deltas: [
      ["Gami Chicken & Beer CBD", "Group-meal language increased, which can pull office and share-box orders away from smaller shops.", 7],
      ["Sam Sam Chicken CBD", "Combo wording now reinforces the lunch-special angle from last week.", 7],
      ["Buza Chicken CBD", "Book-now language suggests a stronger dine-in conversion push alongside delivery.", 5],
    ],
  },
  {
    weeksAgo: 9,
    coverage: 0.86,
    sourceSuccess: 9,
    sourceFail: 1,
    marketStatus: "Volatile",
    reviewGrowth: { target: 15, gami: 29, samsam: 26, buza: 17 },
    keywordAdds: {
      target: ["delivery"],
      gami: ["family box"],
      samsam: ["late night"],
      buza: ["soju"],
    },
    redditPosts: { target: 2, gami: 3, samsam: 4, buza: 2 },
    gap: "Late-night and family-box messaging appeared, which means the market is no longer just fighting for lunch.",
    hook: "Counter with a 9pm-to-close delivery box so Seoul Crunch has a clear answer to late-night chicken searches.",
    deltas: [
      ["Sam Sam Chicken CBD", "Late-night wording appeared and raises the threat after office hours.", 8],
      ["Gami Chicken & Beer CBD", "Family-box language gives groups an easy basket-builder.", 8],
      ["Buza Chicken CBD", "Soju cues strengthen the dine-in and night-out angle.", 6],
    ],
  },
  {
    weeksAgo: 8,
    coverage: 0.9,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Growth",
    reviewGrowth: { target: 24, gami: 41, samsam: 38, buza: 26 },
    keywordAdds: {
      target: ["late night"],
      gami: ["delivery deal"],
      samsam: ["boneless"],
      buza: ["beer"],
    },
    redditPosts: { target: 2, gami: 3, samsam: 4, buza: 2 },
    gap: "Seoul Crunch added late-night language, but competitors are now pushing delivery deals and boneless convenience.",
    hook: "Name the offer around friction, not just food: boneless late-night box, no cutlery drama, delivery-first.",
    deltas: [
      ["Gami Chicken & Beer CBD", "Delivery-deal wording appeared and makes the value proposition more obvious.", 8],
      ["Sam Sam Chicken CBD", "Boneless language adds convenience for delivery customers eating at desks or hotels.", 7],
      ["Buza Chicken CBD", "Beer messaging reinforces night-out positioning but is less delivery-specific.", 5],
    ],
  },
  {
    weeksAgo: 7,
    coverage: 0.92,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Volatile",
    reviewGrowth: { target: 33, gami: 59, samsam: 54, buza: 39 },
    keywordAdds: {
      target: ["boneless box"],
      gami: ["limited offer"],
      samsam: ["student deal"],
      buza: ["late night"],
    },
    redditPosts: { target: 2, gami: 4, samsam: 5, buza: 3 },
    gap: "Competitors are sharpening value language: limited offers, student deals, and late-night positioning all moved in the same week.",
    hook: "Run a student-friendly boneless box for three days only and make the deadline visible in the first line of copy.",
    deltas: [
      ["Sam Sam Chicken CBD", "Student-deal wording is a direct threat in the CBD lunch and after-class window.", 9],
      ["Gami Chicken & Beer CBD", "Limited-offer language adds urgency to delivery decisions.", 8],
      ["Buza Chicken CBD", "Late-night language now overlaps with the position Seoul Crunch just added.", 7],
    ],
  },
  {
    weeksAgo: 6,
    coverage: 0.95,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Growth",
    reviewGrowth: { target: 45, gami: 70, samsam: 68, buza: 48 },
    keywordAdds: {
      target: ["student deal"],
      gami: ["order again"],
      samsam: ["delivery"],
      buza: ["combo"],
    },
    redditPosts: { target: 3, gami: 4, samsam: 5, buza: 3 },
    gap: "Seoul Crunch has caught up on student value, but competitors are broadening repeat-order and delivery convenience hooks.",
    hook: "Turn the student box into a repeatable Tuesday/Wednesday mechanic so it is not just a one-off discount.",
    deltas: [
      ["Gami Chicken & Beer CBD", "Repeat-order language appeared, signalling a loyalty-style move rather than a single promo.", 7],
      ["Buza Chicken CBD", "Combo wording makes the dine-in brand easier to order for delivery.", 6],
      ["Sam Sam Chicken CBD", "Delivery wording stayed prominent alongside its student and combo cues.", 6],
    ],
  },
  {
    weeksAgo: 5,
    coverage: 0.96,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Growth",
    reviewGrowth: { target: 57, gami: 84, samsam: 82, buza: 61 },
    keywordAdds: {
      target: ["repeat deal"],
      gami: ["hot honey"],
      samsam: ["new flavour"],
      buza: ["crispy chicken"],
    },
    redditPosts: { target: 3, gami: 5, samsam: 5, buza: 3 },
    gap: "The market is shifting from price to flavour novelty: hot honey and new-flavour cues are now visible.",
    hook: "Add one named sauce drop for the week so Seoul Crunch has something new to say without discounting again.",
    deltas: [
      ["Gami Chicken & Beer CBD", "Hot-honey language gives the brand a trend-led flavour hook.", 8],
      ["Sam Sam Chicken CBD", "New-flavour wording creates curiosity and repeat-order pressure.", 8],
      ["Buza Chicken CBD", "Crispy-chicken language strengthens core product positioning but is less urgent.", 5],
    ],
  },
  {
    weeksAgo: 4,
    coverage: 0.98,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Volatile",
    reviewGrowth: { target: 73, gami: 102, samsam: 101, buza: 74 },
    keywordAdds: {
      target: ["sauce drop"],
      gami: ["free delivery"],
      samsam: ["free delivery"],
      buza: ["delivery deal"],
    },
    redditPosts: { target: 4, gami: 6, samsam: 6, buza: 4 },
    gap: "Two competitors surfaced free-delivery language in the same week, so the battle moved back to basket conversion.",
    hook: "Do not blindly copy free delivery: test a minimum-spend sauce upgrade so margin is protected while the offer still feels immediate.",
    deltas: [
      ["Gami Chicken & Beer CBD", "Free-delivery wording creates high conversion pressure during dinner windows.", 9],
      ["Sam Sam Chicken CBD", "Free-delivery wording also appeared, suggesting a category-wide promo push.", 9],
      ["Buza Chicken CBD", "Delivery-deal language followed the same direction but with less specific offer clarity.", 7],
    ],
  },
  {
    weeksAgo: 3,
    coverage: 1,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Growth",
    reviewGrowth: { target: 91, gami: 119, samsam: 119, buza: 88 },
    keywordAdds: {
      target: ["minimum spend"],
      gami: ["lunch box"],
      samsam: ["share box"],
      buza: ["late night"],
    },
    redditPosts: { target: 4, gami: 5, samsam: 6, buza: 5 },
    gap: "Lunch boxes and share boxes are reappearing, which points to bigger baskets rather than single-item discounting.",
    hook: "Promote Seoul Crunch as the easiest office share order: one box, three sauces, enough napkins, clear delivery time.",
    deltas: [
      ["Sam Sam Chicken CBD", "Share-box wording makes group ordering easier and threatens larger basket sizes.", 8],
      ["Gami Chicken & Beer CBD", "Lunch-box wording reinforces office-day order capture.", 7],
      ["Buza Chicken CBD", "Late-night language remains active and keeps pressure after 9pm.", 6],
    ],
  },
  {
    weeksAgo: 2,
    coverage: 1,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Growth",
    reviewGrowth: { target: 108, gami: 134, samsam: 138, buza: 101 },
    keywordAdds: {
      target: ["office share box"],
      gami: ["spicy chicken"],
      samsam: ["crispy boneless"],
      buza: ["group meal"],
    },
    redditPosts: { target: 5, gami: 6, samsam: 6, buza: 5 },
    gap: "Competitors are now stressing product texture and group ordering at the same time: spicy, crispy, boneless, group meals.",
    hook: "Use one delivery-page headline: crispy boneless office box, built for groups, ready for CBD lunch.",
    deltas: [
      ["Sam Sam Chicken CBD", "Crispy-boneless wording is a strong convenience and texture hook for delivery.", 8],
      ["Buza Chicken CBD", "Group-meal language now competes directly against the office-share angle.", 7],
      ["Gami Chicken & Beer CBD", "Spicy-chicken language keeps the flavour novelty cycle active.", 6],
    ],
  },
  {
    weeksAgo: 1,
    coverage: 1,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Volatile",
    reviewGrowth: { target: 126, gami: 149, samsam: 158, buza: 116 },
    keywordAdds: {
      target: ["crispy boneless"],
      gami: ["limited sauce"],
      samsam: ["bundle"],
      buza: ["free drink"],
    },
    redditPosts: { target: 5, gami: 7, samsam: 7, buza: 5 },
    gap: "The category is back in offer mode: limited sauces, bundles, and free-drink mechanics all appeared before the weekend.",
    hook: "Refresh Seoul Crunch's office box before Friday with a named sauce and a drink add-on instead of a broad discount.",
    deltas: [
      ["Gami Chicken & Beer CBD", "Limited-sauce wording raises urgency without dropping headline price.", 8],
      ["Sam Sam Chicken CBD", "Bundle language increases average basket pressure before the weekend.", 8],
      ["Buza Chicken CBD", "Free-drink wording creates a simple value comparison for delivery customers.", 7],
    ],
  },
  {
    weeksAgo: 0,
    coverage: 1,
    sourceSuccess: 10,
    sourceFail: 0,
    marketStatus: "Growth",
    reviewGrowth: { target: 139, gami: 161, samsam: 171, buza: 128 },
    keywordAdds: {
      target: ["Friday sauce drop"],
      gami: ["party pack"],
      samsam: ["late night bundle"],
      buza: ["delivery bundle"],
    },
    redditPosts: { target: 6, gami: 7, samsam: 8, buza: 6 },
    gap: "This week is a bundle fight. Competitors are pushing party packs, late-night bundles, and delivery bundles while Seoul Crunch has the clearest office-box position.",
    hook: "Run the Friday Sauce Drop as a delivery-only office box by day and late-night box after 9pm. Keep the offer name identical so customers remember it.",
    deltas: [
      ["Sam Sam Chicken CBD", "Late-night bundle language is the highest-pressure competitor move because it combines timing and basket size.", 9],
      ["Gami Chicken & Beer CBD", "Party-pack language targets larger group orders and can pull weekend baskets away.", 8],
      ["Buza Chicken CBD", "Delivery-bundle wording makes its late-night offer easier to compare in app feeds.", 7],
      ["Seoul Crunch CBD (Demo)", "Owner opportunity: keep the Friday Sauce Drop consistent across website, delivery profile, and counter signage.", 8],
    ],
  },
];

function buildDiagnostics(story) {
  const googleMaps = targets.map((target) => ({
    cafe: target.name,
    override_present: false,
    resolved: true,
    resolved_name: target.name,
    place_id: target.placeId,
    rating: target.baseRating,
    reviews_count: target.baseReviews + story.reviewGrowth[target.key],
    details_context: {
      api_status: "OK",
      website: target.url,
      price_level: 2,
      opening_hours: ["Monday: 11:00 AM - 11:00 PM", "Friday: 11:00 AM - 1:00 AM"],
      reviews_fetched: 5,
    },
    attempts: [
      {
        api_status: "OK",
        via: "demo-seed",
        query: `${target.name} Melbourne CBD Korean fried chicken`,
        name: target.name,
        place_id: target.placeId,
        rating: target.baseRating,
        reviews_count: target.baseReviews + story.reviewGrowth[target.key],
        http_status: 200,
        error_message: null,
      },
    ],
  }));

  const reddit = targets.map((target) => ({
    cafe: target.name,
    fetched: true,
    posts_found: story.redditPosts[target.key],
    subreddits: ["melbourne", "melbournefood", "australia"],
    attempts: [
      { subreddit: "melbourne", http_status: 200 },
      { subreddit: "melbournefood", http_status: 200 },
      { subreddit: "australia", http_status: 200 },
    ],
  }));

  const competitorUrls = targets
    .filter((target) => !target.isPrimary)
    .map((target) => ({
      cafe: target.name,
      url: target.url,
      fetched: true,
      matched_keywords: [...target.websiteKeywords, ...story.keywordAdds[target.key]],
      http_status: 200,
    }));

  return {
    source_stats: {
      success: story.sourceSuccess,
      fail: story.sourceFail,
      failure_ratio: story.sourceFail / Math.max(1, story.sourceSuccess + story.sourceFail),
    },
    google_maps: googleMaps,
    reddit,
    competitor_urls: competitorUrls,
  };
}

function buildReport(story, timestamp) {
  return {
    timestamp,
    market_status: story.marketStatus,
    target_leads: [["Seoul Crunch CBD (Demo)", story.gap, story.hook]],
    competitor_delta: story.deltas,
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(path.join(repoRoot, ".env.local"));
loadEnvFile(path.join(repoRoot, ".env"));

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const accountId = readArg("account-id");
const projectName = readArg("project-name", "Melbourne CBD Korean Fried Chicken Radar");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function getAccountId() {
  if (accountId) {
    return accountId;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data?.id) {
    throw new Error("No account found. Create or sign into an account before seeding demo history.");
  }

  return data.id;
}

async function replaceDemoProject(activeAccountId) {
  const { data: existing, error: existingError } = await supabase
    .from("projects")
    .select("id")
    .eq("account_id", activeAccountId)
    .eq("name", projectName);

  if (existingError) {
    throw existingError;
  }

  if ((existing ?? []).length > 0) {
    const { error: deleteError } = await supabase
      .from("projects")
      .delete()
      .in(
        "id",
        existing.map((project) => project.id),
      );
    if (deleteError) {
      throw deleteError;
    }
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      account_id: activeAccountId,
      name: projectName,
      industry: "delivery-restaurant-demo",
      location: "Melbourne CBD Koreatown - seeded demo",
    })
    .select("id")
    .single();

  if (projectError) {
    throw projectError;
  }

  return project.id;
}

async function createTargets(projectId) {
  const payload = targets.map((target) => ({
    project_id: projectId,
    url: target.url,
    role: target.role,
    is_primary: target.isPrimary,
    resolved_name: target.name,
    resolved_place_id: target.placeId,
  }));

  const { data, error } = await supabase
    .from("project_targets")
    .insert(payload)
    .select("id, resolved_name, role, is_primary");

  if (error) {
    throw error;
  }

  return new Map(data.map((target) => [target.resolved_name, target.id]));
}

async function createRunStory(activeAccountId, projectId, targetsByName, story) {
  const createdAt = isoForWeek(story.weeksAgo, 8);
  const startedAt = isoForWeek(story.weeksAgo, 8);
  const completedAt = isoForWeek(story.weeksAgo, 8);
  const diagnostics = buildDiagnostics(story);
  const report = buildReport(story, createdAt);
  const decisionPack = buildDecisionPack(story, createdAt);

  const { data: run, error: runError } = await supabase
    .from("analysis_runs")
    .insert({
      project_id: projectId,
      account_id: activeAccountId,
      status: story.coverage < 0.4 ? "partial" : "completed",
      stage: "done",
      coverage_score: story.coverage,
      credits_used: 0,
      started_at: startedAt,
      completed_at: completedAt,
      created_at: createdAt,
    })
    .select("id")
    .single();

  if (runError) {
    throw runError;
  }

  const checkpointPayload = [
    {
      run_id: run.id,
      stage: "input_normalization",
      status: "completed",
      payload: { normalized: true, demo_seed: true, demo_story: "melbourne_korean_fried_chicken" },
      created_at: createdAt,
    },
    {
      run_id: run.id,
      stage: "source_collection",
      status: "completed",
      payload: {
        google_records: diagnostics.google_maps.length,
        reddit_posts: diagnostics.reddit.reduce((sum, item) => sum + item.posts_found, 0),
        competitor_websites: diagnostics.competitor_urls.length,
        demo_seed: true,
      },
      created_at: createdAt,
    },
    {
      run_id: run.id,
      stage: "report_generation",
      status: "completed",
      payload: {
        market_status: report.market_status,
        target_leads: report.target_leads.length,
        competitor_deltas: report.competitor_delta.length,
        coverage_score: story.coverage,
        diagnostics,
        persistence_warnings: [],
        demo_seed: true,
      },
      created_at: createdAt,
    },
  ];

  const { error: checkpointError } = await supabase
    .from("run_stage_checkpoints")
    .insert(checkpointPayload);

  if (checkpointError) {
    throw checkpointError;
  }

  const { data: decisionPackRecord, error: decisionPackError } = await supabase
    .from("decision_packs")
    .insert({
      run_id: run.id,
      account_id: activeAccountId,
      project_id: projectId,
      week_label: decisionPack.week_label,
      primary_move_type: decisionPack.primary_move.type,
      primary_move_title: decisionPack.primary_move.title,
      secondary_move_type: decisionPack.secondary_move.type,
      pressure_summary_json: decisionPack.pressure_summary,
      why_now_md: decisionPack.why_now,
      evidence_json: decisionPack.evidence_items,
      expected_effect_md: decisionPack.expected_effect,
      confidence_score: decisionPack.confidence_score,
      execution_assets_json: decisionPack.execution_assets,
      watch_next_week_json: decisionPack.watch_next_week,
      source_flags_json: decisionPack.source_flags,
      created_at: createdAt,
    })
    .select("id")
    .single();

  if (decisionPackError) {
    throw decisionPackError;
  }

  const { data: reportRecord, error: reportError } = await supabase
    .from("reports")
    .insert({
      run_id: run.id,
      account_id: activeAccountId,
      project_id: projectId,
      version: 1,
      status: "approved",
      body: {
        ...report,
        decision_pack_id: decisionPackRecord.id,
      },
      coverage_score: story.coverage,
      approved_at: completedAt,
      created_at: createdAt,
    })
    .select("id")
    .single();

  if (reportError) {
    throw reportError;
  }

  const diagnosticRows = [
    ...diagnostics.google_maps.map((entry) => ({
      run_id: run.id,
      account_id: activeAccountId,
      target_id: targetsByName.get(entry.resolved_name),
      source: "google_maps",
      status: entry.resolved ? "success" : "failed",
      signals_found: entry.resolved ? 1 : 0,
      signals_expected: 1,
      error_message: entry.error_message ?? null,
      detail_payload: entry,
      created_at: createdAt,
    })),
    ...diagnostics.reddit.map((entry) => ({
      run_id: run.id,
      account_id: activeAccountId,
      target_id: targetsByName.get(entry.cafe),
      source: "reddit",
      status: entry.fetched ? "success" : "failed",
      signals_found: entry.posts_found > 0 ? 1 : 0,
      signals_expected: 1,
      error_message: entry.fetched ? null : "Demo discussion fetch failed",
      detail_payload: entry,
      created_at: createdAt,
    })),
    ...diagnostics.competitor_urls.map((entry) => ({
      run_id: run.id,
      account_id: activeAccountId,
      target_id: targetsByName.get(entry.cafe),
      source: "competitor_url",
      status: entry.fetched ? "success" : "failed",
      signals_found: entry.matched_keywords.length > 0 ? 1 : 0,
      signals_expected: 1,
      error_message: entry.error_message ?? null,
      detail_payload: entry,
      created_at: createdAt,
    })),
  ].filter((row) => row.target_id);

  const { error: diagnosticsError } = await supabase
    .from("run_diagnostics")
    .insert(diagnosticRows);

  if (diagnosticsError) {
    throw diagnosticsError;
  }

  const signalRows = [
    {
      run_id: run.id,
      account_id: activeAccountId,
      project_id: projectId,
      target_id: targetsByName.get("Seoul Crunch CBD (Demo)"),
      source: "google_maps",
      signal_type: "owner_opportunity",
      raw_value: story.gap,
      structured_insight: {
        kind: "demo_delivery_market_gap",
        impact: 8,
        confidence: 0.88,
        demo_flag: true,
      },
      confidence_score: 0.88,
      entity_scope: "target",
      created_at: createdAt,
    },
    ...story.deltas
      .map(([name, summary, impact]) => ({
        run_id: run.id,
        account_id: activeAccountId,
        project_id: projectId,
        target_id: targetsByName.get(name),
        source: summary.includes("wording") || summary.includes("language") ? "competitor_url" : "google_maps",
        signal_type: "competitor_move",
        raw_value: summary,
        structured_insight: {
          kind: "demo_competitor_movement",
          venue: name,
          impact,
          confidence: 0.84,
          demo_flag: true,
        },
        confidence_score: 0.84,
        entity_scope: name.includes("Seoul Crunch") ? "target" : "competitor",
        created_at: createdAt,
      }))
      .filter((row) => row.target_id),
  ];

  const { error: signalsError } = await supabase.from("signals").insert(signalRows);

  if (signalsError) {
    throw signalsError;
  }

  return { runId: run.id, reportId: reportRecord.id };
}

const activeAccountId = await getAccountId();
const projectId = await replaceDemoProject(activeAccountId);
const targetsByName = await createTargets(projectId);
const seeded = [];

for (const story of weeklyStories) {
  seeded.push(await createRunStory(activeAccountId, projectId, targetsByName, story));
}

console.log(
  JSON.stringify(
    {
      projectId,
      projectName,
      accountId: activeAccountId,
      seededRuns: seeded.length,
      latestRunId: seeded[seeded.length - 1].runId,
      latestReportId: seeded[seeded.length - 1].reportId,
    },
    null,
    2,
  ),
);
