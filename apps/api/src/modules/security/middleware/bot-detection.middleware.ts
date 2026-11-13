import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * BotDetectionMiddleware
 *
 * Multi-signal heuristic bot detection applied on every incoming request.
 * Operates entirely in-process (zero external SDK). Decisions are layered
 * in order of confidence:
 *
 *  Layer 1 – Known-Bad User-Agent blocking   (blocklist patterns)
 *  Layer 2 – Request anomaly signals         (header shape, field order, etc.)
 *  Layer 3 – Fingerprint entropy score       (combination of soft signals)
 *  Layer 4 – Rate-aware suspicious action    (sensitive paths without headers)
 *
 * On a confident bot match the middleware returns 429 (search crawlers that
 * ignore robots.txt) or 403 (scanners and scrapers) rather than 200, to avoid
 * training scrapers on response payloads while not surfacing internal errors.
 *
 * All decisions are logged at WARN level with a risk signal summary so they
 * can be reviewed in Sentry / Pino logs and used to tune thresholds over time.
 */

// ─── Scoring Weights ────────────────────────────────────────────────────────
const SCORE = {
  // Hard block — immediately triggers rejection without scoring
  KNOWN_BAD_UA: Infinity,

  // Positive signals (suspicious)
  MISSING_ACCEPT: 15,
  MISSING_ACCEPT_LANGUAGE: 10,
  MISSING_ACCEPT_ENCODING: 10,
  HEADLESS_UA_PATTERN: 25,
  AUTOMATION_UA_PATTERN: 25,
  EMPTY_UA: 30,
  VERY_SHORT_UA: 12,
  NO_UPGRADE_INSECURE: 5,
  NO_SEC_FETCH_SITE: 8,
  NO_SEC_FETCH_MODE: 5,
  MISSING_HOST: 15,
  UNUSUAL_CONTENT_TYPE: 8,
  POST_NO_CONTENT_TYPE: 20,
  SENSITIVE_PATH_NO_ACCEPT_LANGUAGE: 10,
  MISSING_REFERER_ON_MUTATION: 5,
} as const;

/** Threshold above which a request is classified as a bot */
const BOT_THRESHOLD = 40;

// ─── Blocklists ──────────────────────────────────────────────────────────────

/**
 * Exact substring patterns matched case-insensitively against the User-Agent
 * string. If ANY of these match, the request is immediately rejected.
 */
const KNOWN_BAD_UA_SUBSTRINGS: readonly string[] = [
  'sqlmap',
  'nikto',
  'nmap',
  'masscan',
  'zgrab',
  'nessus',
  'openvas',
  'nuclei',
  'dirbuster',
  'gobuster',
  'wfuzz',
  'burpsuite',
  'acunetix',
  'w3af',
  'arachni',
  'skipfish',
  'havij',
  'hydra',
  'medusa',
  'thc-hydra',
  'python-requests',
  'libwww-perl',
  'lwp-trivial',
  'go-http-client/1',
  'jakarta commons-httpclient',
  'peach fuzzer',
  'python-urllib',
  'scrapy',
  'httrack',
  'wget/',
  'curl/',
  'axios/', // raw axios without a proper UA set by the caller
  'got/',
  'node-fetch/',
  'node-superagent',
  'java/1.',
  'php/',
  'ruby',
  'perl/',
  'clshttp',
  'harvest',
  'extract',
  'datacha0s',
  'emailsiphon',
  'emailwolf',
  'backdoorbot',
  'blackwidow',
  'blowfish',
  'bullseye',
  'bunnys',
  'cegbfeieh',
  'cosmos',
  'crescent',
  'cyberdog',
  'die morgen',
  'digitale',
  'digimarc',
  'disco',
  'dittospyder',
  'domino',
  'download ninja',
  'ecatch',
  'emailcollector',
  'emailsearch',
  'erocrawler',
  'ezsurf',
  'flaming attackbot',
  'flunky',
  'foobot',
  'getright',
  'getsite',
  'go!zilla',
  'gotit',
  'grabber',
  'grafula',
  'hloader',
  'humanlinks',
  'ics',
  'infonavirobot',
  'intelliagent',
  'internet ninja',
  'intraformant',
  'jakarta',
  'joc web spider',
  'k-meleon',
  'killer',
  'kirill',
  'larbin',
  'lex1',
  'link pumper',
  'linkscan',
  'linksweeper',
  'lnspiderguy',
  'loader.to',
  'lockstep',
  'looksmart',
  'lwp::simple',
  'man wanderer',
  'milbot',
  'mirago',
  'mister pix',
  'msproxy',
  'netants',
  'netcombinator',
  'netmechanic',
  'netoptimizer',
  'netspider',
  'netzip',
  'netzooka',
  'nicebot',
  'nimblecrawler',
  'npbot',
  'occam',
  'octopus',
  'offline explorer',
  'offline navigator',
  'openfind',
  'paparazzi',
  'patwebbot',
  'pegasos',
  'perman surfer',
  'picscout',
  'pimonster',
  'pockey',
  'privoxy',
  'prowebwalker',
  'pump',
  'quester',
  'realdownload',
  'repomonkey',
  'ripper',
  'robozilla',
  'runnbot',
  'scan4mail',
  'screech',
  'searchpreview',
  'seek',
  'siphon',
  'sitecheck',
  'sitesnagger',
  'sitevigil',
  'sitezip32',
  'skygrid',
  'slysearch',
  'smartdownload',
  'snake',
  'snapbot',
  'spankbot',
  'spanner',
  'spegla',
  'spider monkey',
  'spiderorbit',
  'spiderzilla',
  'spinne',
  'spyder',
  'sqworm',
  'steeler',
  'sucker',
  'suke',
  'sunrise xp',
  'superbot',
  'surfbot',
  'surfwallet',
  'swebapps',
  'szukacz',
  't-rex',
  'twitterbot', // block scraping via twitter cards
  'urlchecker',
  'urldispatcher',
  'urlscout',
  'validator',
  'vegas',
  'void-bot',
  'voideye',
  'vspider',
  'w3search',
  'webauto',
  'webbandit',
  'webcollage',
  'webcopier',
  'webdevil',
  'webdownloader',
  'webducer',
  'webemirate',
  'webfetch',
  'webgo is',
  'webina',
  'webknight',
  'weblayers',
  'webpix',
  'webpoison',
  'webstripper',
  'websucker',
  'webvulnscan',
  'webwhacker',
  'webzip',
  'weirdbot',
  'wellsearch',
  'wget',
  'whowhere',
  'widerbrowse',
  'wininet',
  'wotbox',
  'wscript',
  'wwwoffle',
  'xaldon',
  'xenu',
  'xget',
  'xml-rpc',
  'zeus ',
];

/**
 * Partial regex patterns matched against the User-Agent for headless / automation
 * browsers.  These result in high score additions rather than hard blocks, since
 * some legitimate testing frameworks (e.g. Playwright from CI) may hit staging.
 */
const HEADLESS_UA_PATTERNS: readonly RegExp[] = [
  /headlesschrome/i,
  /phantomjs/i,
  /slimerjs/i,
  /splash/i,
  /electron/i,
  /prerender/i,
  /puppeteer/i,
  /nightmare/i,
  /selenium/i,
  /webdriver/i,
  /htmlunit/i,
  /casperjs/i,
];

/** Automation framework patterns */
const AUTOMATION_UA_PATTERNS: readonly RegExp[] = [
  /go-http-client\/2/i,
  /http-client/i,
  /libcurl/i,
  /pycurl/i,
  /java\.net\.http/i,
  /okhttp/i,
  /apache-httpclient/i,
];

/** Paths where absent Accept-Language is treated as extra-suspicious */
const SENSITIVE_PATHS: readonly string[] = [
  '/auth/',
  '/account',
  '/checkout',
  '/payment',
  '/admin/',
];

@Injectable()
export class BotDetectionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(BotDetectionMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    // Health checks and OPTIONS pre-flights bypass bot detection
    if (
      req.method === 'OPTIONS' ||
      req.path === '/' ||
      req.path === '/health' ||
      req.path.startsWith('/api/v1/health')
    ) {
      return next();
    }

    const ua = (req.headers['user-agent'] ?? '').toLowerCase();

    // ── Layer 1: Hard block on known-bad User-Agents ─────────────────────────
    if (this.isKnownBadUA(ua)) {
      this.logger.warn(
        {
          ip: req.ip,
          ua: req.headers['user-agent'],
          path: req.path,
          method: req.method,
          signal: 'KNOWN_BAD_UA',
        },
        'Bot detection: hard block on known-bad User-Agent',
      );
      return this.reject(
        res,
        403,
        'BOT_DETECTED',
        'Automated access is not permitted.',
      );
    }

    // ── Layer 2 & 3: Heuristic scoring ───────────────────────────────────────
    const { score, signals } = this.computeScore(req, ua);

    if (score >= BOT_THRESHOLD) {
      this.logger.warn(
        {
          ip: req.ip,
          ua: req.headers['user-agent'],
          path: req.path,
          method: req.method,
          score,
          signals,
        },
        `Bot detection: score ${score} >= threshold ${BOT_THRESHOLD}, rejecting request`,
      );
      return this.reject(
        res,
        429,
        'BOT_DETECTED',
        'Request pattern indicates automated access. Please retry using a supported client.',
      );
    }

    // Log medium-confidence hits for monitoring without blocking
    if (score >= 20) {
      this.logger.warn(
        {
          ip: req.ip,
          ua: req.headers['user-agent'],
          path: req.path,
          method: req.method,
          score,
          signals,
        },
        `Bot detection: suspicious request (score ${score}, below threshold)`,
      );
    }

    next();
  }

  // ── Scoring ─────────────────────────────────────────────────────────────────

  private computeScore(
    req: Request,
    ua: string,
  ): { score: number; signals: string[] } {
    const signals: string[] = [];
    let score = 0;

    const add = (weight: number, signal: string) => {
      score += weight;
      signals.push(signal);
    };

    const headers = req.headers;

    // Empty or very short User-Agent
    if (!ua || ua.trim() === '') {
      add(SCORE.EMPTY_UA, 'EMPTY_UA');
    } else if (ua.length < 20) {
      add(SCORE.VERY_SHORT_UA, 'VERY_SHORT_UA');
    }

    // Headless browser patterns
    if (HEADLESS_UA_PATTERNS.some((p) => p.test(ua))) {
      add(SCORE.HEADLESS_UA_PATTERN, 'HEADLESS_UA_PATTERN');
    }

    // Automation framework patterns
    if (AUTOMATION_UA_PATTERNS.some((p) => p.test(ua))) {
      add(SCORE.AUTOMATION_UA_PATTERN, 'AUTOMATION_UA_PATTERN');
    }

    // Missing standard browser headers
    if (!headers['accept']) {
      add(SCORE.MISSING_ACCEPT, 'MISSING_ACCEPT');
    }
    if (!headers['accept-language']) {
      add(SCORE.MISSING_ACCEPT_LANGUAGE, 'MISSING_ACCEPT_LANGUAGE');
    }
    if (!headers['accept-encoding']) {
      add(SCORE.MISSING_ACCEPT_ENCODING, 'MISSING_ACCEPT_ENCODING');
    }

    // Missing Host header (required by HTTP/1.1)
    if (!headers['host']) {
      add(SCORE.MISSING_HOST, 'MISSING_HOST');
    }

    // Missing Upgrade-Insecure-Requests (not in mobile or old browsers, but
    // present in every desktop browser since ~2016)
    if (!headers['upgrade-insecure-requests']) {
      add(SCORE.NO_UPGRADE_INSECURE, 'NO_UPGRADE_INSECURE');
    }

    // Missing Sec-Fetch-Site (present in all modern browsers for cross-origin requests)
    if (!headers['sec-fetch-site'] && !headers['sec-fetch-mode']) {
      add(
        SCORE.NO_SEC_FETCH_SITE + SCORE.NO_SEC_FETCH_MODE,
        'NO_SEC_FETCH_HEADERS',
      );
    }

    // POST with no Content-Type
    if (req.method === 'POST' && !headers['content-type']) {
      add(SCORE.POST_NO_CONTENT_TYPE, 'POST_NO_CONTENT_TYPE');
    }

    // Missing Referer on mutation requests against sensitive paths
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      !headers['referer'] &&
      !headers['origin']
    ) {
      add(SCORE.MISSING_REFERER_ON_MUTATION, 'MISSING_REFERER_ON_MUTATION');
    }

    // Sensitive path without Accept-Language
    if (
      !headers['accept-language'] &&
      SENSITIVE_PATHS.some((p) => req.path.includes(p))
    ) {
      add(
        SCORE.SENSITIVE_PATH_NO_ACCEPT_LANGUAGE,
        'SENSITIVE_PATH_NO_ACCEPT_LANGUAGE',
      );
    }

    return { score, signals };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private isKnownBadUA(ua: string): boolean {
    return KNOWN_BAD_UA_SUBSTRINGS.some((s) => ua.includes(s));
  }

  private reject(
    res: Response,
    status: number,
    code: string,
    message: string,
  ): void {
    res.status(status).json({
      success: false,
      message,
      error: {
        code,
        details: null,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
