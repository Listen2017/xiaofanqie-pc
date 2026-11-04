/**
 * POST /api/lead
 * 官网「在线报修 / 服务咨询」表单接收端（Cloudflare Pages Function）
 *
 * 收到表单 → 校验 → 推送到企业微信群机器人（可选再推一份到自建应用私聊）
 *
 * 需要的环境变量（Cloudflare Pages → Settings → Environment variables，加密保存）：
 *   WECOM_WEBHOOK      【推荐】群机器人 Webhook，形如
 *                      https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
 *                      群机器人不受「企业可信 IP」限制，Cloudflare 上唯一稳定的通道
 *
 * 以下为可选的「自建应用私聊」，四个都填才会启用；若应用配了企业可信 IP，
 * 会因 Cloudflare 出口 IP 不固定报 60020，不影响群机器人送达：
 *   WECOM_CORP_ID      企业 ID
 *   WECOM_CORP_SECRET  自建应用的 Secret
 *   WECOM_AGENT_ID     自建应用的 AgentId
 *   WECOM_TO_USER      接收人 userid，多个用 | 分隔；@all 表示可见范围内所有人
 *   WECOM_TO_PARTY     （可选）部门 id
 *   LEADS              （可选）KV 命名空间，绑定后每条线索同时留档 180 天
 */

const QYAPI = "https://qyapi.weixin.qq.com/cgi-bin";

// 同一 isolate 内缓存 access_token（有效期 7200 秒，提前 5 分钟过期）
let tokenCache = { token: "", expireAt: 0 };

// 简单的内存级限流：同一 isolate 内每个 IP 10 分钟最多 6 次
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 6;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function str(v, maxLen) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLen);
}

function nowCN() {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replace(/\//g, "-");
  } catch (e) {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
}

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_HITS) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  // 顺手清掉过期记录，避免 isolate 长跑后 Map 变大
  if (hits.size > 2000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

async function readPayload(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (type.includes("application/json")) {
    try {
      return (await request.json()) || {};
    } catch (e) {
      return {};
    }
  }
  try {
    const fd = await request.formData();
    const obj = {};
    for (const [k, v] of fd.entries()) obj[k] = typeof v === "string" ? v : "";
    return obj;
  } catch (e) {
    return {};
  }
}

async function getAccessToken(env, forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && tokenCache.token && tokenCache.expireAt > now) {
    return tokenCache.token;
  }

  const url =
    `${QYAPI}/gettoken?corpid=${encodeURIComponent(env.WECOM_CORP_ID)}` +
    `&corpsecret=${encodeURIComponent(env.WECOM_CORP_SECRET)}`;
  const res = await fetch(url);
  const body = await res.json();

  if (!body || body.errcode !== 0 || !body.access_token) {
    throw new Error(`gettoken failed: errcode=${body && body.errcode} errmsg=${body && body.errmsg}`);
  }

  const ttl = Math.max(60, (body.expires_in || 7200) - 300) * 1000;
  tokenCache = { token: body.access_token, expireAt: now + ttl };
  return tokenCache.token;
}

async function sendAppMessage(env, content) {
  const payload = {
    msgtype: "text",
    agentid: Number(env.WECOM_AGENT_ID),
    text: { content },
    safe: 0,
  };
  if (env.WECOM_TO_USER) payload.touser = env.WECOM_TO_USER;
  if (env.WECOM_TO_PARTY) payload.toparty = env.WECOM_TO_PARTY;
  if (env.WECOM_TO_TAG) payload.totag = env.WECOM_TO_TAG;

  async function post(token) {
    const res = await fetch(`${QYAPI}/message/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  let body = await post(await getAccessToken(env, false));

  // token 失效或被顶掉时刷新一次重试
  if (body && (body.errcode === 40014 || body.errcode === 42001 || body.errcode === 41001)) {
    body = await post(await getAccessToken(env, true));
  }

  if (!body || body.errcode !== 0) {
    throw new Error(
      `message/send failed: errcode=${body && body.errcode} errmsg=${body && body.errmsg}`
    );
  }
  return true;
}

async function sendRobotMessage(env, content) {
  const res = await fetch(env.WECOM_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content } }),
  });
  const body = await res.json();
  if (!body || body.errcode !== 0) {
    throw new Error(`webhook failed: errcode=${body && body.errcode} errmsg=${body && body.errmsg}`);
  }
  return true;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 只接受本站提交（挡掉别处直接 curl 到接口的情况；没有 Origin 的保留，方便自测）
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return json({ ok: false, error: "bad origin" }, 403);
      }
    } catch (e) {
      return json({ ok: false, error: "bad origin" }, 403);
    }
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (rateLimited(ip)) {
    return json({ ok: false, error: "提交太频繁，请稍后再试或直接打电话" }, 429);
  }

  const raw = await readPayload(request);

  // 蜜罐字段：真人看不见，填了就是机器人
  if (str(raw.hp_field, 50)) {
    return json({ ok: true });
  }

  const lead = {
    name: str(raw.name, 40),
    phone: str(raw.phone, 40),
    device: str(raw.device, 60),
    area: str(raw.area, 200),
    issue: str(raw.issue, 1500),
    page: str(raw.page, 300),
    ip,
    ua: str(request.headers.get("user-agent"), 200),
    receivedAt: new Date().toISOString(),
  };

  if (!lead.name || !lead.phone) {
    return json({ ok: false, error: "请填写称呼和联系电话" }, 400);
  }
  if (!/^[0-9+\-() ]{6,25}$/.test(lead.phone)) {
    return json({ ok: false, error: "电话格式不正确" }, 400);
  }

  const content = [
    "🔧 官网新报修",
    `时间：${nowCN()}`,
    `称呼：${lead.name}`,
    `电话：${lead.phone}`,
    `设备：${lead.device || "未选"}`,
    `区域：${lead.area || "未填写"}`,
    `故障：${lead.issue || "未填写"}`,
    lead.page ? `来源：${lead.page}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);

  const channels = [];
  const errors = [];

  // 通道一：群机器人（推荐）。企业微信「企业可信 IP」对群机器人不生效，Cloudflare 场景最容易跑通。
  if (env.WECOM_WEBHOOK) {
    try {
      await sendRobotMessage(env, content);
      channels.push("webhook");
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }

  // 通道二：自建应用私聊（可选）。需要三件套齐全；若应用配了「企业可信 IP」，
  // 会因 Cloudflare 出口 IP 不固定而报 60020，此时不阻断，靠群机器人送达即可。
  const hasApp = Boolean(env.WECOM_CORP_ID && env.WECOM_CORP_SECRET && env.WECOM_AGENT_ID);
  if (hasApp) {
    try {
      await sendAppMessage(env, content);
      channels.push("app");
    } catch (err) {
      const msg = String(err.message || err);
      errors.push(msg);
      if (msg.includes("60020")) {
        console.warn("自建应用被企业可信IP拦截(60020)，本次仅通过群机器人送达");
      }
    }
  }

  // 可选：KV 留档
  if (env.LEADS && typeof env.LEADS.put === "function") {
    try {
      const key = `lead:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      await env.LEADS.put(key, JSON.stringify(lead), { expirationTtl: 60 * 60 * 24 * 180 });
    } catch (err) {
      console.error("kv archive failed", err);
    }
  }

  if (channels.length === 0) {
    const detail = errors.length
      ? errors.join(" | ")
      : "未配置任何推送通道（WECOM_WEBHOOK 或 自建应用三件套）";
    console.error("lead delivery failed:", detail);
    return json({ ok: false, error: "推送失败，请直接电话联系" }, 502);
  }

  return json({ ok: true, channels });
}

export async function onRequestGet() {
  return json({ ok: false, error: "method not allowed" }, 405);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
