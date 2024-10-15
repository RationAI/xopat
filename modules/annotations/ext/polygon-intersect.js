//TODO rename
OSDAnnotations.checkPolygonIntersect = (function () {

const pointState = {
    undefined: 0,
    outPoly: 1,
    inPoly: 2,
    onEdge: 3
};

class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.distance = 0;
        this._state = pointState.undefined;
    }
    toString() {
        return 'Point';
    }
    setState(value) {
        this._state = value;
    }
    getState() {
        return this._state;
    }
    calcDistance(point) {
        this.distance = Math.sqrt(Math.pow(point.x - this.x, 2) + Math.pow(point.y - this.y, 2));
        this.distance = Math.round(this.distance * 100) / 100;
    }
    valueOf() {
        return {x: this.x, y: this.y};
    }
    isCoordEqual(point) {
        return this.x === point.x && this.y === point.y;
    }
    compare(value) {
        if (Array.isArray(value) && value.length) {
            for (var point of value) {
                if (this.isCoordEqual(point)) {
                    return false;
                }
            }
        } else if (value.toString() === 'Point') {
            if (this.isCoordEqual(value)) {
                return false;
            }
        }
        return true;
    }
}

const edgeState = {
    undefined: 0,
    outOut: 1,
    outIn: 2,
    inOut: 3,
    inIn: 4
};

class Edge {
    constructor(point1, point2) {
        this._p1 = point1;
        this._p2 = point2;
        this._state = edgeState.undefined;
        this._intersectElements = [];
        this._intersectCount = 0;
    }
    getStartPoint() {
        return this._p1;
    }
    getEndPoint() {
        return this._p2;
    }
    changePoints() {
        let temp = this._p1;
        this._p1 = this._p2;
        this._p2 = temp;
    }
    isPointExist(point) {
        return (this._p1.x === point.x && this._p1.y === point.y) ||
            (this._p2.x === point.x && this._p2.y === point.y);
    }
    setState(pState) {
        switch (pState) {
            case pointState.outPoly:
                this._state = (this._intersectCount % 2) ? edgeState.outIn : edgeState.outOut;
                break;
            case pointState.inPoly:
            case pointState.onEdge:
                this._state = (this._intersectCount % 2) ? edgeState.inOut : edgeState.inIn;
                break;
        }
    }
    getState() {
        return this._state;
    }
    getIntersectElements() {
        return this._intersectElements;
    }
    addIntersectElement(edge, point) {
        this._intersectCount++;
        this._intersectElements.push({edge: edge, point: point});
    }
    getIntersectCount() {
        return this._intersectCount;
    }
    isIntersectHorizontalRayPoint(point) {
        return point.y >= this._p1.y && point.y < this._p2.y ||
            point.y >= this._p2.y && point.y < this._p1.y;
    }
    getIntersectionRayX(point) {
        return (this._p2.x - this._p1.x) * (point.y - this._p1.y) /
            (this._p2.y - this._p1.y) + this._p1.x;
    }
    findIntersectingPoint(edge) {
        const divider = (edge._p2.y - edge._p1.y) * (this._p2.x - this._p1.x) -
            (edge._p2.x - edge._p1.x) * (this._p2.y - this._p1.y);
        const numerA = (edge._p2.x - edge._p1.x) * (this._p1.y - edge._p1.y) -
            (edge._p2.y - edge._p1.y) * (this._p1.x - edge._p1.x);
        const numerB = (this._p2.x - this._p1.x) * (this._p1.y - edge._p1.y) -
            (this._p2.y - this._p1.y) * (this._p1.x - edge._p1.x);

        if (!divider || (!numerA && !numerB)) {
            return false;
        }

        const uA = numerA / divider;
        const uB = numerB / divider;

        if (uA < 0 || uA > 1 || uB < 0 || uB > 1) {
            return false;
        }
        const x = Math.round((this._p1.x + uA * (this._p2.x - this._p1.x)) * 100) / 100;
        const y = Math.round((this._p1.y + uA * (this._p2.y - this._p1.y)) * 100) / 100;

        return new Point(x, y);
    }
}

const direction = {
    backward: 0,
    forward: 1
};

class Polygon {
    constructor(arrPoints) {
        if (!Array.isArray(arrPoints) || !arrPoints.length) {
            arrPoints = [];
        }
        this._points = arrPoints.map(item => new Point(item.x, item.y));
        this._edges = this._points.map((item, i, arr) => {
            return new Edge(item, arr[(i + 1) % arr.length]);
        });
        this._edgesIndex = 0;
        this._direction = direction.forward;
        this._intersectionEnd = false;
    }
    isIntersectionEnd() {
        return this._intersectionEnd;
    }
    endIntersection() {
        this._intersectionEnd = true;
    }
    getEdges() {
        return this._edges;
    }
    getNextEdge() {
        if (this._direction === direction.backward) {
            this._edgesIndex = (--this._edgesIndex < 0) ? this._edges.length - 1 : this._edgesIndex;
        } else {
            this._edgesIndex = ++this._edgesIndex % this._edges.length;
        }
        return this._edges[this._edgesIndex];
    }
    isEdgeExist(edge) {
        return this._edges.indexOf(edge) + 1;
    }
    setDirection(intersectEdge, nextEdge) {
        let ind1 = this._edges.indexOf(intersectEdge);
        let ind2 = this._edges.indexOf(nextEdge);
        this._edgesIndex = ind2;
        this._direction = (ind2 % (this._edges.length - 1) <= ind1) ? direction.backward :
            direction.forward;
    }
    getPoints() {
        return this._points;
    }
    isPointsOnEdgesAndOut() {
        for (let point of this._points) {
            if (point.getState() !== pointState.outPoly &&
                point.getState() !== pointState.onEdge) {
                return false;
            }
        }
        return true;
    }
    getPointsResult() {
        return this._points.map(point => point.valueOf());
    }
    addPoint(point) {
        this._points.push(point);
    }
    isPointExist(point) {
        return this._points.indexOf(point) + 1;
    }
    calcPointsInPoly(poly) {
        let count = 0;
        this._points.forEach(point => {
            if (poly.isPointInPoly(point)) {
                count++;
            }
        });
        return count;
    }
    isPointInPoly(point) {
        let isIn = false;
        let intersectX;
        this._edges.forEach(edge => {
            if (edge.isIntersectHorizontalRayPoint(point)) {
                intersectX = edge.getIntersectionRayX(point);
                if (point.x === intersectX) {
                    point.setState(pointState.onEdge);
                }
                isIn = (point.x <= intersectX) ? !isIn : isIn;
            }
        });
        if (point.getState() === pointState.undefined) {
            point.setState(isIn ? pointState.inPoly : pointState.outPoly);
        }
        return isIn;
    }
}

class PolygonArray {
    constructor() {
        this._polygons = [];
    }
    add(poly) {
        this._polygons.push(poly);
    }
    getLast() {
        return this._polygons[this.getLength() - 1];
    }
    getLength() {
        return this._polygons.length;
    }
    getPoints() {
        let points = this._polygons.map(poly => poly.getPoints());
        return [].concat(...points);
    }
    getResult() {
        this._polygons = this._polygons.filter(poly => {
            return poly.getPoints().length && !poly.isPointsOnEdgesAndOut();
        });
        if (!this._polygons.length) {
            return this._polygons;
        }
        let points = this._polygons.map(poly => poly.getPointsResult());
        return (points.length > 1 && this.getLast().getPoints().length) ? points :
            [].concat(...points);
    }
}

function testInputValues(poly1, poly2) {
    if (!Array.isArray(poly1) || !Array.isArray(poly2)) {
        throw new TypeError('Both of input values must be an array');
    } else if (poly1.length < 3 || poly2.length < 3) {
        throw new RangeError('Lengths of input values must be greater than two');
    }
}

function isOnePolyInOther(poly1, poly2) {
    let countPointsIn;
    for (let poly of [poly1, poly2]) {
        let secondPoly = (poly === poly1) ? poly2 : poly1;
        countPointsIn = poly.calcPointsInPoly(secondPoly);
        if (countPointsIn === poly.getPoints().length) {
            return poly.getPointsResult();
        } else if (countPointsIn) {
            break;
        }
    }
    return false;
}

function findEdgeIntersection(edge, edges) {
    if (edge.getIntersectElements().length) {
        return;
    }
    let intersectPoint;
    edges.forEach(intersectEdge => {
        intersectPoint = edge.findIntersectingPoint(intersectEdge);
        if (intersectPoint.toString() === 'Point') {
            edge.addIntersectElement(intersectEdge, intersectPoint);
        }
    });
}

function reduceEdges(edges, edge) {
    let index = edges.indexOf(edge);
    if (index + 1) {
        edges.splice(index, 1);
    }
    return edges;
}


return function (poly1, poly2) {
    try {
        testInputValues(poly1, poly2);
    } catch (e) {
        return e;
    }

    poly1 = new Polygon(poly1);
    poly2 = new Polygon(poly2);

    let result = isOnePolyInOther(poly1, poly2);
    if (result) {
        return result;
    }

    let intersectPolies = new PolygonArray();
    intersectPolies.add(new Polygon());

    let point;
    let elem;
    let edges = poly1.getEdges();

    for (let edge of edges) {
        point = edge.getStartPoint();
        findPointInPoly(point, poly2);
        findEdgeIntersection(edge, poly2.getEdges());

        if (!edge.getIntersectCount()) {
            continue;
        }

        elem = getFirstIntersectElem(edge, point);
        if (!elem) {
            continue;
        }

        addIntersectPoint(elem.point, poly2);
        findNextIntersectPoint(edge);
    }

    return intersectPolies.getResult();


    function findNextIntersectPoint(edge) {
        let poly = poly1.isEdgeExist(elem.edge) ? poly2 : poly1;
        let ownPoly = (poly === poly1) ? poly2 : poly1;

        let point1 = elem.edge.getStartPoint();
        let point2 = elem.edge.getEndPoint();
        poly.isPointInPoly(point1);
        poly.isPointInPoly(point2);

        let edgePart1 = new Edge(elem.point, point1);
        let edgePart2 = new Edge(elem.point, point2);

        let edges = [].slice.call(poly.getEdges());
        reduceEdges(edges, edge);

        findEdgeIntersection(edgePart1, edges);
        findEdgeIntersection(edgePart2, edges);

        edgePart1.setState(point1.getState());
        edgePart2.setState(point2.getState());

        let nextStartPoint;
        let nextPart;
        if (point1.getState() === pointState.outPoly && (edgePart1.getIntersectCount() % 2) ||
            point1.getState() === (pointState.inPoly || pointState.onEdge) &&
            !(edgePart1.getIntersectCount() % 2)) {
            nextStartPoint = point1;
            nextPart = edgePart1;
        } else {
            nextStartPoint = point2;
            nextPart = edgePart2;
        }
        if (nextPart.getIntersectCount()) {
            let element = getFirstIntersectElem(nextPart, elem.point);
            if (element) {
                edge = elem.edge;
                elem = element;
                addIntersectPoint(element.point, poly);
                return findNextIntersectPoint(edge);
            }
        }

        edges = [].slice.call(ownPoly.getEdges());
        reduceEdges(edges, elem.edge);

        let nextEdge;
        for (let edge of edges) {
            if (edge.isPointExist(nextStartPoint)) {
                nextEdge = edge;
                break;
            }
        }

        if (!nextEdge.getStartPoint().isCoordEqual(nextStartPoint)) {
            nextEdge.changePoints();
        }
        ownPoly.setDirection(elem.edge, nextEdge);

        for (var i = 0; i < ownPoly.getEdges().length; i++) {
            if (i !== 0) {
                nextEdge = ownPoly.getNextEdge();
            }

            point = nextEdge.getStartPoint();
            findPointInPoly(point, poly);
            findEdgeIntersection(nextEdge, poly.getEdges());

            if (!nextEdge.getIntersectCount()) {
                continue;
            }

            elem = getFirstIntersectElem(nextEdge, point);
            if (!elem) {
                return;
            }

            addIntersectPoint(elem.point, poly);
            return findNextIntersectPoint(nextEdge);
        }
    }


    function addIntersectPoint(point, poly) {
        if (point.getState() === pointState.undefined) {
            poly.isPointInPoly(point);
        }
        let intersectPoly = intersectPolies.getLast();
        if (intersectPoly.isIntersectionEnd()) {
            intersectPolies.add(new Polygon());
        }
        intersectPoly.addPoint(point);
    }

    function findPointInPoly(point, poly) {
        if (point.compare(intersectPolies.getPoints()) && poly.isPointInPoly(point)) {
            addIntersectPoint(point, poly);
        }
    }

    function getFirstIntersectElem(edge, point) {
        let intersections = edge.getIntersectElements();
        intersections = intersections.filter(intersect =>
            intersect.point.compare(intersectPolies.getPoints()));
        if (!intersections.length) {
            intersectPolies.getLast().endIntersection();
            return false;
        }

        edge.setState(point.getState());

        if (intersections.length > 1) {
            intersections.forEach(intersect => intersect.point.calcDistance(point));
            intersections.sort((a, b) => a.point.distance - b.point.distance);
        }
        return intersections[0];
    }
}
})();
