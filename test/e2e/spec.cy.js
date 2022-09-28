describe('My First Test', () => {
  it('Does not do much!', () => {
    cy.launch({
      visualisation: {
        "data":["test/srcimg/TP-2019_7207-06-1.tif","test/annotation/TP-2019_7207-06-1-annot.tif","test/experiments/ViT-Test-5483-4ad7-9d7f-950846037b59/TP-2019_7207-06-1-vis.tif"],
        "background":[{"dataReference":0,"lossless":false}]
      }
    })
    expect(true).to.equal(true)
  })
})