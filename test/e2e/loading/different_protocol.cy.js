
// describe('Third party pyramidal image', () => {
//     it('Background only: custom protocol', () => {
//         cy.launch({
//             visualisation: {
//                 "data":["https://libimages1.princeton.edu/loris/pudl0001%2F4609321%2Fs42%2F00000001.jp2/info.json"],
//                 "background":[{
//                     "dataReference":0,
//                     "lossless":false,
//                     "protocol":"`${data}`"
//                 }]
//             }
//         })
//         expect(true).to.equal(true)
//     })
// })


/**TODO TEST
 *
 {
 "params": {
"debugMode": false,
        "webglDebugMode": false,
"tileCache": false
} ,
   "data":[
      "https://libimages1.princeton.edu/loris/pudl0001%2F4609321%2Fs42%2F00000001.jp2/info.json"
   ],
   "background":[
      {
         "dataReference":0,
         "lossless":false,
         "protocol":"`${data}`"
      }
   ],
   "visualizations":[
      {
         "name":"The book is rendered twice, once as overlay.",
"protocol":"`${data}`",
         "shaders":{
            "0":{
               "name":"Heatmap overlay",
               "type":"heatmap",
               "visible":1,
               "params":{
                  "color":{
                     "type":"color",
                     "default":"#12fbff"
                  }
               },
               "dataReferences":[
                  0
               ]
            }
         }
      }
   ]
}
 */
describe('Third party pyramidal image', () => {
    it('Full rendering options: only one layer available.', () => {
        cy.launch({
            visualisation: {
                "data":["https://libimages1.princeton.edu/loris/pudl0001%2F4609321%2Fs42%2F00000001.jp2/info.json"],
                "background":[{
                    "dataReference":0,
                    "lossless":false,
                    "protocol":"`${data}`"
                }],
                "visualizations":[{
                    "name":"The book is rendered twice, once as overlay.",
                    "protocol":"`${data}`",
                    "shaders":{
                        "0": {
                            "name": "Heatmap overlay",
                            "type": "heatmap", "visible": 1,
                            "params": {
                                "color": {
                                    "type": "color",
                                    "default": "#12fbff"
                                },
                            },
                            "dataReferences": [0],
                        }
                    },
                }]
            }
        })
        expect(true).to.equal(true)
    })
})