export default {
    presetUi: (presetIndex) => cy.get("#preset-no-" + presetIndex),
    presetUiColor: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(1).find("input"),
    presetUISelect: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(0).find("select"),
    presetUiNthMetaContainer: (presetIndex, metaIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(metaIndex + 2),
    presetUiNthMeta: (presetIndex, metaIndex) =>
        cy.get("#preset-no-" + presetIndex).children('.show-hint').eq(metaIndex + 2).find("input"),
    presetUiNewMetaName: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children().last().find("input"),
    presetUiNewMetaButton: (presetIndex) =>
        cy.get("#preset-no-" + presetIndex).children().last().find("span"),
    presetUiSelectLeft: () => cy.get("#select-annotation-preset-left"),
    presetUiSelectRight: () => cy.get("#select-annotation-preset-right"),
    presetUiLeft: () => cy.get("#annotations-left-click"),
    presetUiRight: () => cy.get("#annotations-right-click"),

    ALTdown: () => cy.keyDown("Alt", {altKey: true, focusCanvas: true}),
    ALTup: () => cy.keyUp("Alt", {altKey: true, focusCanvas: true}),
}