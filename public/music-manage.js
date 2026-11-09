const destination = new URL("/manage.html", location.origin);
destination.search = location.search;
destination.hash = "playlists";
location.replace(destination.href);
