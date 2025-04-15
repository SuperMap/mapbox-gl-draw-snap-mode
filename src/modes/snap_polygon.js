import MapboxDraw from "@mapbox/mapbox-gl-draw";
import {
  addPointToVertices,
  createSnapList,
  getFormattedSnapVertexPriorityDistance,
  getGuideFeature,
  IDS,
  shouldHideGuide,
  snap,
} from "./../utils/index.js";
import booleanIntersects from "@turf/boolean-intersects";

const { doubleClickZoom } = MapboxDraw.lib;
const { geojsonTypes, modes, cursors } = MapboxDraw.constants;
const DrawPolygon = MapboxDraw.modes.draw_polygon;
const SnapPolygonMode = { ...DrawPolygon };

SnapPolygonMode.onSetup = function (options) {
  const polygon = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: geojsonTypes.POLYGON,
      coordinates: [[]],
    },
  });

  const verticalGuide = this.newFeature(getGuideFeature(IDS.VERTICAL_GUIDE));
  const horizontalGuide = this.newFeature(
    getGuideFeature(IDS.HORIZONTAL_GUIDE)
  );

  this.addFeature(polygon);
  this.addFeature(verticalGuide);
  this.addFeature(horizontalGuide);

  const selectedFeatures = this.getSelected();
  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);
  const draw = this._ctx.api;
  const params = {
    currentFeature: polygon,
    snapFeatures: this._ctx.options.snapOptions?.snapFeatures
  };
  const [snapList, vertices] = createSnapList(
    this.map,
    draw,
    params,
    this._ctx.options.snapOptions?.snapGetFeatures
  );

  const state = {
    map: this.map,
    polygon,
    currentVertexPosition: 0,
    vertices,
    snapList,
    selectedFeatures,
    verticalGuide,
    horizontalGuide,
  };

  /// Adding default options
  state.options = Object.assign(this._ctx.options, {
    overlap: true,
  });

  const updateSnapList = (e) => {
    const params = {
      currentFeature: polygon,
      snapFeatures: state.options.snapOptions?.snapFeatures
    };
    const [snapList, vertices] = createSnapList(
      this.map,
      draw,
      params,
      this._ctx.options.snapOptions?.snapGetFeatures
    );
    state.vertices = vertices;
    state.snapList = snapList;
  };
  const optionsChangedCallback = (options) => {
    state.options = options;
  };

  // for removing listener later on close
  state["optionsChangedCallback"] = optionsChangedCallback;
  state["updateSnapList"] = updateSnapList;
  this.map.off('moveend', draw.updateSnapList);
  Object.assign(draw, { updateSnapList });
  this.map.on("moveend", updateSnapList);
  this.map.on("draw.snap.options_changed", optionsChangedCallback);

  return state;
};
//  MS 中切换为 该模式时，立刻快速点击地图，控制台报错Uncaught Error: Invalid LngLat object: (NaN, NaN)
SnapPolygonMode.onClick = function (state, e) {
  // We save some processing by rounding on click, not mousemove
  const lng = state.snappedLng ?? e.lngLat.lng;
  const lat = state.snappedLat ?? e.lngLat.lat;

  // End the drawing if this click is on the previous position
  if (state.currentVertexPosition > 0) {
    const lastVertex =
      state.polygon.coordinates[0][state.currentVertexPosition - 1];

    state.lastVertex = lastVertex;

    if (lastVertex[0] === lng && lastVertex[1] === lat) {
      return this.changeMode(modes.SIMPLE_SELECT, {
        featureIds: [state.polygon.id],
      });
    }
  }

  // const point = state.map.project();

  addPointToVertices(state.map, state.vertices, { lng, lat });

  state.polygon.updateCoordinate(`0.${state.currentVertexPosition}`, lng, lat);

  state.currentVertexPosition++;

  state.polygon.updateCoordinate(`0.${state.currentVertexPosition}`, lng, lat);
};

SnapPolygonMode.onMouseMove = function (state, e) {
  const draw = this._ctx.api;
  const params = {
    currentFeature: state.polygon,
    snapFeatures: state.options.snapOptions?.snapFeatures
  };
  const [snapList, vertices] = createSnapList(
    this.map,
    draw,
    params,
    this._ctx.options.snapOptions?.snapGetFeatures
  );
  state.vertices = vertices;
  state.snapList = snapList;

  // 动态调整snapVertexPriorityDistance
  state.options.snapOptions.snapVertexPriorityDistance = getFormattedSnapVertexPriorityDistance(this.map.getZoom());

  const { lng, lat } = snap(state, e);

  state.polygon.updateCoordinate(`0.${state.currentVertexPosition}`, lng, lat);
  state.snappedLng = lng;
  state.snappedLat = lat;

  if (
    state.lastVertex &&
    state.lastVertex[0] === lng &&
    state.lastVertex[1] === lat
  ) {
    this.updateUIClasses({ mouse: cursors.POINTER });

    // cursor options:
    // ADD: "add"
    // DRAG: "drag"
    // MOVE: "move"
    // NONE: "none"
    // POINTER: "pointer"
  } else {
    this.updateUIClasses({ mouse: cursors.ADD });
  }
};

// This is 'extending' DrawPolygon.toDisplayFeatures
SnapPolygonMode.toDisplayFeatures = function (state, geojson, display) {
  if (shouldHideGuide(state, geojson)) return;

  // This relies on the the state of SnapPolygonMode being similar to DrawPolygon
  DrawPolygon.toDisplayFeatures(state, geojson, display);
};

// This is 'extending' DrawPolygon.onStop
SnapPolygonMode.onStop = function (state) {
  this.deleteFeature(IDS.VERTICAL_GUIDE, { silent: true });
  this.deleteFeature(IDS.HORIZONTAL_GUIDE, { silent: true });

  // remove moveend callback
  this.map.off("moveend", state.updateSnapList);
  this.map.off("draw.snap.options_changed", state.optionsChangedCallback);

  var userPolygon = state.polygon;
  if (state.options.overlap) {
    DrawPolygon.onStop.call(this, state);
    return;
  }
  // if overlap is false, mutate polygon so it doesn't overlap with existing ones
  // get all editable features to check for intersections
  var features = this._ctx.store.getAll();

  try {
    var edited = userPolygon;
    features.forEach(function (feature) {
      if (userPolygon.id === feature.id) return false;
      if (!booleanIntersects(feature, edited)) return;
      edited = turf.difference(edited, feature);
    });
    state.polygon.coordinates =
      edited.coordinates || edited.geometry.coordinates;
  } catch (err) {
    // cancel this polygon if a difference cannot be calculated
    DrawPolygon.onStop.call(this, state);
    this.deleteFeature([state.polygon.id], { silent: true });
    return;
  }

  // monkeypatch so DrawPolygon.onStop doesn't error
  var rc = state.polygon.removeCoordinate;
  state.polygon.removeCoordinate = () => {};
  // This relies on the the state of SnapPolygonMode being similar to DrawPolygon
  DrawPolygon.onStop.call(this, state);
  state.polygon.removeCoordinate = rc.bind(state.polygon);
};

export default SnapPolygonMode;
