import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

const frame = document.querySelector("iframe")!;
window.addEventListener("message", (event) => {
  if (
    event.source === frame.contentWindow &&
    event.data?.method === "ui/message"
  ) {
    (window as any).tourRawMessage = event.data.params;
  }
});
const bridge = new AppBridge(
  null,
  { name: "Test host", version: "1" },
  {
    serverTools: {},
    message: { text: {} },
    updateModelContext: { text: {} },
    experimental: { "openai/message": {} },
  },
  { hostContext: { displayMode: "fullscreen", theme: "dark" } },
);
bridge.oncalltool = async (params) => {
  const response = await fetch("/tour-test-mcp", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return response.json();
};
bridge.onmessage = async (params) => {
  (window as any).tourMessage = params;
  return {};
};
bridge.onupdatemodelcontext = async (params) => {
  (window as any).tourContext = params;
  return {};
};
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  const response = await fetch("/tour-test-mcp", {
    method: "POST",
    body: JSON.stringify({ name: "tour_open", arguments: {} }),
  });
  await bridge.sendToolResult(await response.json());
};
void bridge
  .connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!))
  .then(() => {
    frame.srcdoc = (window as any).tourHtml;
  });
