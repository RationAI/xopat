# Extra Tutorials
Adds the possibility to create tutorials within an external system and enable them or run them immediately.

The parameters of this plugin expect ``data`` element to be present, an array of objects that have:
- [R]`title` - the tutorial name
- [O]`description` - the tutorial description
- [O]`runDelay` - whether to run the tutorial immediately or not; only first element is run, others are ignored, default `undefined`, otherwise set a MS delay for the tutorial to start, minimum 250ms
- [O]`attach` - whether to enable the user to run the tutorial whenever they want, default `true`
- [R]`content` - the tutorial content, a list of objects of `RULE -> TEXT` mapping that define what rule (context action + selector, e.g. `"click #item"`) maps to what textual description in each tutorial step

Example of running a focus-context simple tutorial upon the opening, without attaching it to available tutorials list:
````json
{
  "plugins": {
    "extra-tutorials":{"data":[{"run":true,"content":[{"click #presenter-play-icon": "Please, click play<br>to run the story."}]}]},
    "recorder": {} //note: ensures the plugin is available when we direct the the tutorial on it
  }
}
````
 


