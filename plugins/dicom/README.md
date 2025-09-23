# Dicom Integration

To configure a DICOM server, provide a service URL configuration of this plugin, for example:

``
"serviceUrl": "http://localhost:8042/dicom-web"
``

Opening DICOM series using this plugin is straightforward: just provide in the configuration data list 
an object describing the DICOM study, instead of traditional string ID.

````js
"data": [{ "seriesUID": "1.2.826.0.1.3680043.8.498.77278192630710008320308486728784799314" }],
"background": [
    {
        "dataReference": 0,
    }
]
````

Opening a study dynamically is also possible, but no longer directly from the data specification, but configuring the plugin:
````json
"plugins": {
  "dicom": {
    "defaultStudy": "1.2.826.0.1.3680043.8.498.35759453015100453210054623601138997522"
  }
}
````