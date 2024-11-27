import van from "../vanjs.mjs";

const { button } = van.tags

/**
 * 
 * @param {*} props
 * @param {string} props.text
 * @returns 
 */
const TestButton = ({
    text,
    onClick,
    id,

}) => {
    return button(
        { id: id, class: "btn btn-primary btn-xs", onclick: () => onClick() },
        text)
}

export { TestButton };
