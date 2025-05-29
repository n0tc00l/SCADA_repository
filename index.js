import fs from "node:fs/promises";
import dgram from "node:dgram";
import https from "node:https";
import http from "node:http";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import modbus from "./modbus.js";
import objectmodel from "./mathmodel/mm.js";

// Get your own keys, or replace WebSocket's HTTPs server with an HTTP server
// in [data-server <-> clients] scope
//const key = await fs.readFile("../privkey.pem"); 
//const cert = await fs.readFile("../cert.pem");

const settings_path = "settings.json";
const archive_path = "archive.db";
// Should do start checks:
// a) settings check
// b) archive check (should have a0 and should have the same fields as settings)

/// ---------------------------------------------------------------------------
/// settings
/// ---------------------------------------------------------------------------
const settings = await (async () => {
    const s = JSON.parse(await fs.readFile(settings_path, { encoding: 'utf-8' }));
    for (const v of s.variables) {
        const fbody = (a) => `"use-strict";return ${a}`;
        if ("prefix" in v)
            v.prefix = Function("v", "value", fbody(v.prefix));
        if ("recieve" in v && "read_function" in v.recieve)
            v.recieve.read_function = Function("prev", "curr", fbody(v.recieve.read_function));
    }
    s.archive = s.archive || {};
    s.archive.interval_ms = 1000 * (s?.archive?.interval_s ?? 60);
    return s;
})();

/// ---------------------------------------------------------------------------
/// stored_data (variables, archive - all shared state in general)
/// ---------------------------------------------------------------------------
const stored_data = (() => {
    const variables = Object.fromEntries(settings.variables.map(
        (v) => [v.name, null]
    ));
    const archive = (() => {
        const db = new Database(archive_path);
        db.pragma("journal_mode = WAL");
        const last_intervals = Math.floor((db.prepare(
            "SELECT time FROM a0 ORDER BY time DESC LIMIT 1"
        ).raw(true).get()?.[0] ?? 0) / (settings.archive.interval_ms));                    
        return { db, last_intervals };
    })();
    return { variables, archive };
})();

/// ---------------------------------------------------------------------------
/// functions
/// ---------------------------------------------------------------------------

// [devices -> data-server] scope 
(async () => {
    const modbus_udp_slave = (() => {
        const soket = dgram.createSocket('udp4');
        soket.bind(3001);
        return soket;
    })();
    modbus_udp_slave.on("message", function read_data(msg, rinfo) {
        try {
            const { unit_id, pdu } = modbus.tcp_adu(
                new DataView(msg.buffer, msg.byteOffset, msg.byteLength)
            );
            modbus.pdu(pdu, {
                16: ({ start_address, data }) => put_data(unit_id, start_address * 2, data),
                default: () => console.log(`modbus function not implemented`)
            });
        }
        catch (error) {
            if (error instanceof RangeError)
                console.log(`Ill-formed Modbus UDP message: ${error.message}`);
            else throw error;
        }
    });
})();

const put_data = function() {
    // Functor with a private state
    const write_variables = Object.groupBy(settings.variables
        .filter((v) => "recieve" in v)
        .map((v) => {
            if ("type" in v.recieve) {
                v.recieve.size = Number(v.recieve.type.match(/.\d$/)[0]) / 8;
                v.recieve.type_function = `get${v.recieve.type}`;
            }
            else
                v.recieve.size = 0;
            return v;
        })
        .sort((a, b) => a.recieve.address < b.recieve.address),
        ({ recieve: { unit } }) => unit // Group by unit
    );

    return async function put_data(unit, start_address, data) {
        const g = write_variables[unit];
		console.log(data);
        if (!g)
            return console.log(`no unit ${unit}`);
        const start = g.findIndex((v) => v.recieve.address >= start_address);
        if (start !== -1) for (const v of Array.from(g).slice(start)) {
            const { address, type_function, le, read_function, size = 0 } = v.recieve;
            const offset = address - start_address;
            if (offset + size > data.byteLength) break;
            const value = type_function ?
                data[type_function](offset, le) :
                read_function(data);
			console.log(value);
            v.prefix?.(value, stored_data.variables);
            stored_data.variables[v.name] = value;
        }
        write_archive(Date.now());
    }
}();



const write_archive = function() {
    // Functor with a private state
    // (There is one archive table for every 1999 variables)
    try {
        
    const archive_stmts = Object.entries(Object.groupBy(settings.variables,
        (_, i) => Math.floor(i / 1999))).map(([k, v]) => [
            `INSERT OR IGNORE INTO a${k} VALUES (?,${v.map(() => '?').join(',')})`,
            `DELETE FROM a${k} WHERE time/1000 < unixepoch('now', '-${
                settings?.archive?.max_time ?? "3 months"
            }', 'localtime')`
        ].map((v) => stored_data.archive.db.prepare(v)));
    
    return function(time) {
        const now_intervals = Math.floor(time / settings.archive.interval_ms);
        if (now_intervals > stored_data.archive.last_intervals) {
            stored_data.archive.last_intervals = now_intervals;
            const vars = Array.from(settings.variables.map((v) => stored_data.variables[v]));
            console.log(`Archiving at ${new Date(time)}`);
            archive_stmts.forEach((stmts) => {
                stmts[0].run(
                    now_intervals * settings.archive.interval_ms,
                    ...vars.slice(0, 1999) // Always takes the next 1999 and mutates itself
                );
                stmts[1].run();
            });
        }
    }

    } catch (error) {
        console.log("Wrong archive structure.");
        throw error;
    }
}();

// [data-server <-> clients] scope
(async () => {
    const sent_variables = Object.fromEntries(settings.variables.map(
        (v) => [v.name, { sent: null, threshold: v.threshold ?? 0.1 }]
    ));
    const groups = new Map();
    const wss = await (async () => {
        const server = http.createServer(); //https.createServer({ key, cert });
        const wss = new WebSocketServer({ server });
        server.listen(3002);
        return wss;
    })();

    wss.on("connection", function (socket, request) {
        console.log(`${request.socket.remoteAddress} connected`);
    
        socket.on("message", (data, isBanary) => {
            try {
                const request = JSON.parse(data);

				console.log(	request );
                // Only handles subscribing to recieving variables ("v" command).
                // Requesting archives ("a" command)
                // or changing stored-data from the client is currently unimplemented.
                if (request.hasOwnProperty("v"))
                {
                    socket.vnames = new Set(request.v.sort());
                    socket.group = groups.get(socket.vnames) ?? (() => {
                        const group = [];
                        groups.set(socket.vnames, group);
                        console.log(`Connection group created: ${[...socket.vnames]}`);
                        return group;
                    })();
                    socket.group.push(socket);
                
                    const v = Object.entries(stored_data.variables)
                        .filter(([k, _]) => socket.vnames.has(k))
                        .map(([k, _]) => [k, sent_variables[k].sent]);
                    if (v.length !== 0)
                        socket.send(JSON.stringify({ v: Object.fromEntries(v) }));
                }
				 if (request.hasOwnProperty("w"))
                {
					
					console.log(	'---------w--------' );
					console.log(	request.w );
					
					try {
						request.w.map(([key, value]) => {
						if (!key || value === undefined) {
							throw new Error('Invalid data format');
						}
						if (stored_data?.variables?.hasOwnProperty(key) && typeof value === 'number' && !isNaN(value)) {
							stored_data.variables[key] = value;
						}
						
						console.log(key);
						console.log(value);
						
						}) 
					}catch (error) {
						console.error('Processing failed:', error);
						}	
						//key: key.toString().trim(),
						//value: Number(value) || 0
      					
					//request.w.forEach(([key, value]) => {
					//console.log(`${key}: ${value}`);
					//	});
				}
				
            } catch (error) {
                console.log(`${request}: invalid WebSocket request (${error.message})`);
                socket.close();
            }
        });
		
		socket.on("write", (data) => {
            try {
                const request = JSON.parse(data);
				console.log(request);
              
            } catch (error) {
                console.log(`${request}: invalid WebSocket request (${error.message})`);
               
            }
        });
		
        socket.on("close", (code, reason) => {
            if (socket.group) {
                socket.group.splice(socket.group.indexOf(socket),1)
                if (socket.group.length === 0) {
                    groups.delete(socket.vnames);
                    console.log(`Connection group deleted: ${[...socket.vnames]}`);
                }
            }
            console.log(`${request.socket.remoteAddress} disconnected`);
        });
    });



    setInterval(function connection_group_output() {
        const changed = Object.entries(stored_data.variables)
            .filter(([k, v]) => {
                const { sent, threshold } = sent_variables[k];
                return v != null && Math.abs(v - sent ?? 0) > threshold;
            });
        if (changed.length !== 0) {
            for (const [vnames, sokets] of groups) {
                const v = changed.filter(([k, _]) => vnames.has(k))
                for (const s of sokets)
                    s.send(JSON.stringify({ v: Object.fromEntries(v) }));
            }
            changed.forEach(([k, v]) => sent_variables[k].sent = v);
        }
    }, 1000);

    
})();


setInterval(function timer_math_object_model(){objectmodel.math_object_model(stored_data)}, 500);
    //setInterval(function math_object_model() {
    //    stored_data.variables['PobrKK'] = stored_data.variables['PobrKK'] +10;
    //    console.log('1111111111111111');
    //}, 2000);

/// ---------------------------------------------------------------------------
/// start
/// ---------------------------------------------------------------------------
console.table({
    "Now": new Date(Date.now()).toLocaleString(),
    "Last archived": new Date(
        stored_data.archive.last_intervals * settings.archive.interval_ms 
    ).toLocaleString(),
    "Rows": stored_data.archive.db.prepare("SELECT COUNT(1) FROM a0").raw(true).get()[0]
});

// Clean up the archive on exit by committing WAL files
// (does not work if exiting from VS Code;
//  won't break the archive though, only for debug)
process.on('exit', () => {
    console.log('Exiting');
    stored_data.archive.db.close();
});
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));
