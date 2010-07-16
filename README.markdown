Antinode is a simple static file webserver built on node.js.

# Usage

Run it from the command line. 

   $ node server.js [settings.json]

Requires Node.JS v0.1.97 or greater.
If you want to bind to a port under 1024, you'll need to run node with special
privileges.

# Configuration

Configuration is through a JSON text file, by default the `settings.json` in
the same folder as `server.js`.

Example settings file:

    {
        "port" : 8080,
        "hosts" : {
            "subdomain1.example.com" : { 
                "root" : "/www/subdomain1/"
            },
            "subdomain2.example.com" : {
                "root" : "/www/subdomain2/"
            }
            },
        "default_host" : {
            "root" : "/www/default/"
        }
    }

This server listens on port 8080 for HTTP requests.
If it gets a request for `Host: subdomain1.example.com` the site will serve
`/www/subdomain1/`, and similarly requests for `Host: subdomain2.example.com`
will respond with the files from `/www/subdomain2`. If the `Host` header does
not match either, or is not given, antinode will serve files from
`/www/default`.

Explanation of properties:

- `port` - the port to listen for HTTP connections on. default: 8080
- `hosts` - an object with one property name per virtual host address, with the value of a 'virtual host' object to 
- `default_host` - the 'virtual host' object to default to if no other virtual hosts match, or the HTTP `Host` header is not given
- `log_level` - specifys what should be logged
- `script_cache` - if scripts should be cached (if true, you have to restart the server when making changes on a script)
- `timeout_milliseconds` - timeout in milliseconds


'virtual host object' properties:

- `root` - giving the directory to serve web requests from
- `script` - script which is executed when there is a request to the host
- `not_found` - script which is executed when a file is not found
- `internal_error` - script which is executed when there is an internal error
- `server_script_error` - script which is executed when there was a error in a script


This serves up all the files in `/var/www` listening to HTTP requests on port 8080.
E.g. an HTTP request for `/styles/site.css` will will look for the file `/var/www/styles/site.css`

# Features

- HTTP `Content-Type` header detection from file extension
- HTTP `Content-Length` header support
- HTTP `Date` header
- HTTP `Last-Modified` header
- Reads files in binary mode - so can serve images and other binary files (not just text)
- Requests to any `directory` try to return `directory/index.html`
- Virtual Hosts

# Test Suite


To run the tests:

    $ node runtests.js

# Credits

Original code forked from [Noah Sloan](http://github.com/iamnoah)'s [simple logging webserver](http://gist.github.com/246761).
