# Python Playground

Supports a JSON parameter that describes what algorithms are available.

````json
{
  "server": "<value>",
  "algorithm_id" : {
    "name": "<title>",
    "server": "<value>", //e.g. http://localhost:5000/  where the playground listens to, optional
    "params": {
      <<whatever you want to have your program receive>>
    }   
  } 
}
````

The URL leads to the server where _python mediator_ listens for requests. The workflow is as follows:
 1. **Initialization** the implementation of the mediator should answer with TODO
 2. **Requests** further requests to the mediator are TODO
