## Localhost Docker for PHP
This docker image has no browsing interface: you must create
the session queries manually. For more user-friendly use case, use
the xopat-docker repository.

This image is ready to serve the viewer code directly from
the host to allow interactive programming while having easy setup.
The default image server is (due to CORS policy) proxied
> ``/wsi-server/<YOUR SERVER HTTP QUERY>  --->  https://localhost:8080/<YOUR SERVER HTTP QUERY>``

And works with the env configuration:
````json
"image_group_server": "/wsi-server/", //the server url mapped to host machine localhost at port 8080
"image_group_protocol": "`${path}v3/slides/${data}/info`", //the server query
"image_group_preview": "`${path}v3/slides/${data}/thumbnail/max_size/1024/1024`", //the thumbnail query
````
This can be changed in the apache configuration file. To build image (using name `xopat` and tag `v1`):

 ``docker build -t xopat:v1 -f Dockerfile .``

run image first time (at localhost:8000/xopat/index.php and mounting the volume so that we 
can access this local repository _THIS REPOSITORY PATH_ and have direct changes applied):

 ``docker run -d -p 8000:8000 --name xopat -v [THIS REPOSITORY PATH]:/var/www/html/xopat xopat:v1``

(you can add  ``--rm`` for run command to autoremove container after
it was stopped); to
stop and start existing container:
 
``docker start xopat``

 ``docker stop xopat``

### Issue Solving

Note that OpenSeadragon should be compiled inside this project and set
up for the viewer to work. 

> Warning: you are likely to run into CORS issues when trying to open
> the viewer with an external server. To avoid these, ensure you
> access a local address as the image server and map this address in ``apache.conf``
> proxy to the remote server URL.

To debug (and modify at runtime) reverse proxy do:

````bash
docker exec -it xopat bash # enter container
cat /var/log/apache2/error.log  # see errors
nano /etc/apache2/sites-available/000-default.conf # edit server config
apache2ctl graceful # restart server
````

To clean up images (unused), do:
`````shell
docker images --quiet --filter=dangling=true | xargs --no-run-if-empty docker rmi
`````


