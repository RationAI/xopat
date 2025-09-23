# Dicom Web Integration

To configure a DICOM server, provide a service URL configuration of this plugin, for example:

``
"serviceUrl": "http://localhost:8042/dicom-web"
``

Opening DICOM series using this plugin is straigforward: just provide in the configuration an object
describing the DICOM element.

````js
"data": [{ "seriesUID": "1.2.826.0.1.3680043.8.498.77278192630710008320308486728784799314" }],
"background": [
    {
        "dataReference": 0,
    }
]
````