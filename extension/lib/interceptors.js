// Products that are known to re-sign TLS traffic with their own CA.
// Used only to put a name on an interception that the other signals already
// revealed (local certificate not publicly logged and/or different from what
// external notaries see). A name match alone never raises an alarm.

export const INTERCEPTOR_KINDS = ['corporateProxy', 'cloudProxy', 'antivirus', 'contentFilter', 'debugProxy', 'adware'];

const PRODUCTS = [
  // Cloud security gateways
  { name: 'Zscaler', kind: 'cloudProxy', pattern: /zscaler/i },
  { name: 'Netskope', kind: 'cloudProxy', pattern: /netskope|goskope/i },
  { name: 'Cisco Umbrella', kind: 'cloudProxy', pattern: /cisco umbrella|opendns/i },
  { name: 'Cloudflare Gateway', kind: 'cloudProxy', pattern: /cloudflare for teams|gateway ca - cloudflare/i },
  { name: 'Skyhigh / McAfee Web Gateway', kind: 'cloudProxy', pattern: /skyhigh|mcafee web gateway/i },
  { name: 'Menlo Security', kind: 'cloudProxy', pattern: /menlo security/i },
  { name: 'iboss', kind: 'cloudProxy', pattern: /\biboss\b/i },
  // Firewalls and on-premises proxies
  { name: 'Fortinet FortiGate', kind: 'corporateProxy', pattern: /fortinet|fortigate/i },
  { name: 'Palo Alto Networks', kind: 'corporateProxy', pattern: /palo alto networks/i },
  { name: 'Check Point', kind: 'corporateProxy', pattern: /check ?point/i },
  { name: 'Sophos', kind: 'corporateProxy', pattern: /sophos/i },
  { name: 'Forcepoint / Websense', kind: 'corporateProxy', pattern: /forcepoint|websense/i },
  { name: 'Blue Coat / Symantec ProxySG', kind: 'corporateProxy', pattern: /blue ?coat|proxysg/i },
  { name: 'Barracuda', kind: 'corporateProxy', pattern: /barracuda/i },
  { name: 'WatchGuard', kind: 'corporateProxy', pattern: /watchguard/i },
  { name: 'SonicWall', kind: 'corporateProxy', pattern: /sonicwall/i },
  { name: 'Untangle', kind: 'corporateProxy', pattern: /untangle/i },
  { name: 'Squid', kind: 'corporateProxy', pattern: /\bsquid\b/i },
  // Antivirus HTTPS scanning
  { name: 'Kaspersky', kind: 'antivirus', pattern: /kaspersky/i },
  { name: 'ESET', kind: 'antivirus', pattern: /\beset ssl filter|\beset\b/i },
  { name: 'Avast', kind: 'antivirus', pattern: /avast/i },
  { name: 'AVG', kind: 'antivirus', pattern: /\bavg web\/mail shield|\bavg\b/i },
  { name: 'Bitdefender', kind: 'antivirus', pattern: /bitdefender/i },
  { name: 'Norton', kind: 'antivirus', pattern: /norton/i },
  { name: 'Dr.Web', kind: 'antivirus', pattern: /dr\.?web/i },
  // School / parental content filters
  { name: 'Lightspeed Systems', kind: 'contentFilter', pattern: /lightspeed/i },
  { name: 'Securly', kind: 'contentFilter', pattern: /securly/i },
  { name: 'GoGuardian', kind: 'contentFilter', pattern: /goguardian/i },
  { name: 'ContentKeeper', kind: 'contentFilter', pattern: /contentkeeper/i },
  { name: 'Smoothwall', kind: 'contentFilter', pattern: /smoothwall/i },
  // Developer debugging proxies
  { name: 'mitmproxy', kind: 'debugProxy', pattern: /mitmproxy/i },
  { name: 'Fiddler', kind: 'debugProxy', pattern: /fiddler/i },
  { name: 'Charles Proxy', kind: 'debugProxy', pattern: /charles proxy/i },
  { name: 'Burp Suite', kind: 'debugProxy', pattern: /portswigger|burp/i },
  { name: 'OWASP ZAP', kind: 'debugProxy', pattern: /owasp|zed attack proxy|zap root ca/i },
  { name: 'Proxyman', kind: 'debugProxy', pattern: /proxyman/i },
  { name: 'HTTP Toolkit', kind: 'debugProxy', pattern: /http toolkit/i },
  // Adware that shipped its own root
  { name: 'Superfish / Komodia', kind: 'adware', pattern: /superfish|komodia/i },
];

function labelsOf(name) {
  if (!name) {
    return [];
  }
  return [name.commonName, name.organization, name.organizationalUnit].filter(Boolean);
}

/** Looks for a known interception product in the issuers of a described chain. */
export function identifyInterceptor(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return null;
  }
  const candidates = [];
  for (const cert of chain) {
    candidates.push(...labelsOf(cert.issuer));
  }
  candidates.push(...labelsOf(chain[chain.length - 1].subject));
  for (const text of candidates) {
    const hit = PRODUCTS.find((p) => p.pattern.test(text));
    if (hit) {
      return { name: hit.name, kind: hit.kind, matched: text };
    }
  }
  return null;
}
