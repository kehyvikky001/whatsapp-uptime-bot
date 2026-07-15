import "./load-env.js";

const args = process.argv.slice(2);
const command = args.shift();

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = process.env.BOT_API_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error("ADMIN_TOKEN is required");
  process.exit(1);
}

async function request(method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });

  const text = await response.text();
  if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`);
  return text ? JSON.parse(text) : null;
}

try {
  switch (command) {
    case "account:list":
      console.table(await request("GET", "/accounts"));
      break;
    case "account:add":
      console.log(await request("POST", "/accounts", {
        id: requiredOption("--id"),
        phoneNumber: requiredOption("--phone")
      }));
      break;
    case "account:pair": {
      const id = requiredOption("--id");
      const result = await request("POST", `/accounts/${encodeURIComponent(id)}/pairing-code`);
      console.log(`Pairing code for ${id}: ${result.pairingCode}`);
      break;
    }
    case "account:enable": {
      const id = requiredOption("--id");
      console.log(await request("POST", `/accounts/${encodeURIComponent(id)}/enable`));
      break;
    }
    case "account:disable": {
      const id = requiredOption("--id");
      console.log(await request("POST", `/accounts/${encodeURIComponent(id)}/disable`));
      break;
    }
    case "account:reconnect": {
      const id = requiredOption("--id");
      console.log(await request("POST", `/accounts/${encodeURIComponent(id)}/reconnect`));
      break;
    }
    case "account:remove": {
      const id = requiredOption("--id");
      await request("DELETE", `/accounts/${encodeURIComponent(id)}`);
      console.log(`Removed ${id}`);
      break;
    }
    default:
      console.log(`Commands:
  account:list
  account:add --id NAME --phone COUNTRYCODE_NUMBER
  account:pair --id NAME
  account:enable --id NAME
  account:disable --id NAME
  account:reconnect --id NAME
  account:remove --id NAME`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
