The first thing, to have working xOpat instance is to have deployed image server.
We will use image server we are maintaining: [WSI-Service](https://github.com/RationAI/WSI-Service).

!!! note 
    If you already have your own Image Server deployed, you can skip this part.

## How to deploy WSI-Service?
1. Download some WSI test slides. It does not matter where the slides come from, but they 
must be compatible with the image server used. Test data can be found for example on [openslide.org](https://openslide.org)

    !!! note
        the Simple Mapper we will be using needs to have slides in certain hiearchy:
        ```
        root-folder
        ├── case1
        │   ├── slide1_1
        │   └── slide1_2
        ├── case2
        │   └── slide2_1
        ...
        ```

    !!! tip
        The server state cached. If you want to add new slides, you need to go to visit [http://localhost:8080/refresh_local_mapper]() 
        to revalidate the cache.

2. Clone WSI-Service repository (note the ```--recursive``` flag: there are submodules):
    ```
    git clone --recursive https://github.com/RationAI/WSI-Service.git
    ``` 

3. Create .env file in the root folder of repository. Make sure ``COMPOSE_DATA_DIR`` points to the
folder with downloaded slides, ``root-folder``.

    ``` bash title=".env"
        # if true, it will allow logging functionality
        WS_DEBUG=False
        # if true, it will make OpenAPI sites available
        WS_DISABLE_OPENAPI=True
        # url of service which maps slide ids to path. We use build in service
        WS_MAPPER_ADDRESS=http://localhost:8080/slides/storage?slide={slide_id}
        # How the mapper resolves slide paths
        WS_LOCAL_MODE=wsi_service.simple_mapper:SimpleMapper

        # this variables are configuring docker compose file
        COMPOSE_RESTART=no
        COMPOSE_NETWORK=default
        COMPOSE_WS_PORT=8080
        # directory where the test slides are saved
        COMPOSE_DATA_DIR=path/to/slides

        # server API configuration
        WS_CORS_ALLOW_CREDENTIALS=False
        WS_CORS_ALLOW_ORIGINS=["*"]

        # Timeouts and size settings
        WS_INACTIVE_HISTO_IMAGE_TIMEOUT_SECONDS=600
        WS_MAX_RETURNED_REGION_SIZE=25000000
        WS_MAX_THUMBNAIL_SIZE=500
        WS_ENABLE_VIEWER_ROUTES=False
    ```

4. Make sure that [Docker](https://docs.docker.com/get-started/) and [Docker Compose](https://docs.docker.com/compose/) is installed on your machine. 
   
    !!! info
        If you do not have these applications, the easiest way is to use [Docker Desktop](https://www.docker.com/products/docker-desktop/).
        The commands can be different based on used [docker distribution](https://docs.docker.com/compose/support-and-feedback/faq/#what-is-the-difference-between-docker-compose-and-docker-compose).
   
    Example of the docker compose yaml used by the environment configuration: 
    ??? example "docker-compose.yml"

        ```yml
        version: "3.8"

        services:
        wsi_service:
            build:
            context: "."
            target: wsi_service_production
            network: "${COMPOSE_NETWORK}"
            restart: "${COMPOSE_RESTART}"
            environment:
            - WS_CORS_ALLOW_CREDENTIALS=${WS_CORS_ALLOW_CREDENTIALS}
            - WS_CORS_ALLOW_ORIGINS=${WS_CORS_ALLOW_ORIGINS}
            - WS_DEBUG=${WS_DEBUG}
            - WS_DISABLE_OPENAPI=${WS_DISABLE_OPENAPI}
            - WS_MAPPER_ADDRESS=${WS_MAPPER_ADDRESS}
            - WS_LOCAL_MODE=${WS_LOCAL_MODE}
            - WS_ENABLE_VIEWER_ROUTES=${WS_ENABLE_VIEWER_ROUTES}
            - WS_INACTIVE_HISTO_IMAGE_TIMEOUT_SECONDS=${WS_INACTIVE_HISTO_IMAGE_TIMEOUT_SECONDS}
            - WS_MAX_RETURNED_REGION_SIZE=${WS_MAX_RETURNED_REGION_SIZE}
            volumes:
            - ${COMPOSE_DATA_DIR}:/data
            ports:
            - ${COMPOSE_WS_PORT}:8080
        ```

5. Finally run the docker container by:
    ```bash
    docker compose up
    ```

    !!! tip
        you can add ```-d``` flag, for program to detach from your terminal.

This should make WSI server running on [localhost:8080](http://localhost:8080). For more information feel free to check the repository of [WSI-Service](https://github.com/RationAI/WSI-Service).
