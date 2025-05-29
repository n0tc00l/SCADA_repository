//const ws = new WebSocket(`ws://185.45.62.6:3002`);
const ws = new WebSocket(`ws://127.0.0.1:3002`);
document.addEventListener('alpine:init', () => {
    Alpine.store("ws", ws);
    Alpine.store("request", (data) => {
        const swap_request = () => {
            Alpine.store("request", () => ws.send(JSON.stringify(data)));
            ws.send(JSON.stringify(data));
        };
        if (ws.readyState === ws.OPEN)
            swap_request();
        else {
            Alpine.store("v", data.v.reduce((prev, curr) =>
                ({ ...prev, [curr]: undefined }), {}));
            ws.addEventListener("open", swap_request, { once: true });
        }
    });
    ws.addEventListener("message", (event) =>
        Object.entries(JSON.parse(event.data))
            .forEach(([k, v]) => Alpine.store(k, {
                ...Alpine.store(k), ...v
            })
            )
    );
});
