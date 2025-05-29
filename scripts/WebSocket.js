const socket = new WebSocket("   ");

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.valveId && data.state) {
        valves[data.valveId].setState(data.state);
    }
};