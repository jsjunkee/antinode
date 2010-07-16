var http = require('http'),
    fs = require('fs'),
    pathlib = require('path'),
    uri = require('url'),
    mime = require('./content-type'),
    log = require('./log'),
    package = JSON.parse(fs.readFileSync(__dirname+'/../package.json', 'utf8')),
    sys = require('sys'),
    Script = process.binding('evals').Script;

exports.default_settings = {
    "timeout_milliseconds": 1000 * 30,
    "hosts" : {},
    "port" : 8080, /* a port that you don't need root to bind to */
    "default_host" : {
        "root" : process.cwd()
    },
    "log_level" : log.levels.DEBUG
};
exports.log_levels = log.levels;

var settings;

var server;

/* require() all the scripts at the start, so there's no
 * waiting for in the middle of a request
 * also require() all error_scripts */
function load_hostspecific_scripts() {
    var server_errors = ["not_found", "internal_error", "server_script_error"];
    var server_errors_default = ["404: File not found.", "500: Internal server error.", "500: Error executing server script."];
    for (var host in settings.hosts) {
        var script = settings.hosts[host]['script'];
        if (script !== undefined) {
            /* remove filename extension */
            var require_name = script.match(/(.*)\..*/)[1];
            settings.hosts[host].handle = require(require_name).handle;
        }
        for(var i=0; i<server_errors.length; i++) {
            if(settings.hosts[host][server_errors[i]])
                settings.hosts[host][server_errors[i]] = require(settings.hosts[host][server_errors[i]]).handle;
            else
                settings.hosts[host][server_errors[i]] = server_errors_default[i];
        }
    }
    for(var i=0; i<server_errors.length; i++) {
        if(settings.default_host[server_errors[i]])
            settings.default_host[server_errors[i]] = require(settings.default_host[server_errors[i]]).handle;
        else
            settings.default_host[server_errors[i]] = server_errors_default[i];
    }
}

exports.start = function(custom_settings, callback) {
    settings = custom_settings || {};
    settings.__proto__ = exports.default_settings;
    
    load_hostspecific_scripts();

    log.level = settings.log_level;
    log.info( "Starting server on port", settings.port);
    
    server = http.createServer(function(req,resp) {
        log.debug("Request from", req.connection.remoteAddress, "for", req.url);
        log.debug(JSON.stringify(req.headers));

        var url = uri.parse(req.url);
        //if the parsed url doesn't have a pathname, default to '/'
        var pathname = (url.pathname || '/');
        var clean_pathname = pathname.
            replace(/\.\.\//g,''). //disallow parent directory access
                replace(/\%20/g,' ');  //convert spaces

        function select_vhost() {
            if (req.headers.host) {
                var hostname = req.headers.host.split(':')[0]; //remove port
                return settings.hosts[hostname] || settings.default_host;
            } else {
                return settings.default_host;
            }
        }
        var vhost = select_vhost(req.headers.host);
        if (vhost['handle'] !== undefined) {
            vhost.handle(req,resp);
        } else {
            var path = pathlib.join(vhost.root, clean_pathname);
            if (path.match(/\.sjs$/)) {
                execute_sjs(path, req, resp, vhost);
            } else {
                serve_static_file(path, req, resp, vhost);
            }
        }
    });
    server.listen(settings.port);
    server.addListener('listening', function() {
        if (callback) callback();
    });
    server.addListener('connection', function(connection) {
        connection.setTimeout(settings.timeout_milliseconds);
        connection.addListener('timeout', function() {
            log.debug("Connection from",connection.remoteAddress,"timed out.");
            connection.destroy();
        });
    });
};

exports.stop = function(callback) {
    if (server) {
        if (callback) server.addListener('close', callback);
        server.close();
    }
};

function serve_static_file(path, req, resp, host) {
    function send_headers(httpstatus, length, content_type, modified_time) {
        var headers = {
            "Server": "Antinode/"+package.version+" Node.js/"+process.version,
            "Date": (new Date()).toUTCString()
        };
        if (length) {
            headers["Content-Length"] = length;
        }
        if (content_type) {
            headers["Content-Type"] = content_type || "application/octet-stream";
        }
        if (modified_time) { 
            headers["Last-Modified"] = modified_time.toUTCString(); 
        }
        resp.writeHead(httpstatus, headers);
        log.info(req.connection.remoteAddress,req.method,path,httpstatus,length);
    }

    fs.stat(path, function (err, stats) {
        if (err) {
            // ENOENT is normal on 'file not found'
            if (err.errno != process.ENOENT) { 
                // any other error is abnormal - log it
                log.error("fs.stat(",path,") failed: ", err);
            }
            return file_not_found();
        }
        if (stats.isDirectory()) {
            return serve_static_file(pathlib.join(path, "index.html"), req, resp, host);
        }
        if (!stats.isFile()) {
            return file_not_found();
        } else {
            var if_modified_since = req.headers['if-modified-since'];
            if (if_modified_since) {
                var req_date = new Date(if_modified_since);
                if (stats.mtime <= req_date && req_date <= Date.now()) {
                    return not_modified();
                }
                else stream_file(path, stats);
            } else if (req.method == 'HEAD') {
                send_headers(200, stats.size, mime.mime_type(path), stats.mtime);
                finish(resp);
            } else {
                return stream_file(path, stats);
            }
        }
    });

    function stream_file(file, stats) {
        try {
            var readStream = fs.createReadStream(file);
        } 
        catch (err) {
            log.debug("fs.createReadStream(",file,") error: ",sys.inspect(err));
            return file_not_found();
        }

        send_headers(200, stats.size, mime.mime_type(file), stats.mtime);

        req.connection.addListener('timeout', function() {
            /* dont destroy it when the fd's already closed */
            if (readStream.fd) {
                log.debug('timed out. destroying file read stream');
                readStream.destroy();
            }
        });

        readStream.addListener('open', function() {
            log.debug("opened",path);
        });
        readStream.addListener('data', function (data) {
            // send it out
            resp.write(data);
        });
        readStream.addListener('error', function (err) {
            log.error('error reading',file,sys.inspect(err));
            finish(resp);
        });
        readStream.addListener('end', function () {
            finish(resp);
        });
    }

    function not_modified() {
        // no need to send content length or type
        log.debug("304 for resource ", path);
        send_headers(304);
        finish(resp);
    }

    function file_not_found() {
        log.debug("404 opening path: '"+path+"'");
        if(typeof host.not_found != "string")
            host.not_found(req, resp);
        else {
            send_headers(404,host.not_found.length,"text/plain");
            if (req.method != 'HEAD') {
                resp.write(host.not_found);
            }
            finish(resp);
        }
    }

    function server_error(message) {
        log.error(message);
        if(typeof host.internal_error != "string")
            host.internal_error(req, resp);
        else {
            send_headers(500,host.internal_error.length,"text/plain");
            if (req.method != 'HEAD') {
                resp.write(host.internal_error);
            }
            finish(resp);
        }
    }

}

function execute_sjs(path, req, resp, host) {
    if(sjs_cache[path])
        return execute_sjs_script(sjs_cache[path], req, resp, path);
    fs.readFile(path, 'utf8', function(err, script) {
        try {
            if(err) throw err;
            sjs_cache[path] = new Script(script); // very nice, but you need to restart the sever if you have got a new script.. *ugly*
            execute_sjs_script(sjs_cache[path], req, resp, path);
        }
        catch (e) {
            if(typeof host.server_script_error != "string")
                host.server_script_error(req, resp, e);
            else {
                resp.writeHead(500,{'Content-Type':'text/plain'});
                if (req.method != 'HEAD') {
                    resp.write(host.server_script_error);
                }
                resp.end();
            }
        }
    });
}

function execute_sjs_script(script, req, resp, path) {
    var sandbox = {
        log: log,
        require: require,
        __filename: path,
        __dirname: pathlib.dirname(path)
    };
    script.runInNewContext(sandbox);
    sandbox.handle(req, resp);
}

var sjs_cache = {};

function finish(resp) {	
    resp.end();
    log.debug("finished response");
}

function close(fd) {
    fs.close(fd);
    log.debug("closed fd",fd);
}
