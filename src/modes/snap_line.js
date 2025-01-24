import MapboxDraw from "@mapbox/mapbox-gl-draw";
const {
  geojsonTypes,
  modes,
  cursors,
} = MapboxDraw.constants;
const { doubleClickZoom } = MapboxDraw.lib;
const DrawLine = MapboxDraw.modes.draw_line_string;

import {
  addPointTovertices,
  createSnapList,
  getGuideFeature,
  IDS,
  shouldHideGuide,
  snap,
} from "./../utils";

const SnapLineMode = { ...DrawLine };

SnapLineMode.onSetup = function (options) {
  const feature = this.newFeature({
    type: geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: geojsonTypes.LINE_STRING,
      coordinates: [[]],
    },
  });

  const verticalGuide = this.newFeature(getGuideFeature(IDS.VERTICAL_GUIDE));
  const horizontalGuide = this.newFeature(
    getGuideFeature(IDS.HORIZONTAL_GUIDE)
  );

  this.addFeature(feature);
  this.addFeature(verticalGuide);
  this.addFeature(horizontalGuide);

  const selectedFeatures = this.getSelected();
  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);
  let layers = this.map.getStyle().layers;
  const targetLayers = layers.filter(layerInfo => {
    const { type, source } = layerInfo;
    if ((source !== 'mapbox-gl-draw-cold' && source !== 'mapbox-gl-draw-hot') && (type === 'circle' || type === 'line' || type === 'fill')) {
      return true;
    };
  });
  let targetLayersId = targetLayers.map((layerInfo) => {
    return layerInfo.id;
  });
  // const [snapList, vertices] = createSnapList(this.map, this._ctx.api, line, targetLayersId);

  const state = {
    prevQueryBbox: null,
    targetLayersId,
    map: this.map,
    feature,
    line: feature,
    currentVertexPosition: 0,
    // vertices,
    // snapList,
    selectedFeatures,
    verticalGuide,
    horizontalGuide,
    direction: "forward"
  };

  state.options = this._ctx.options;
  const draw = this._ctx.api;

  const updateSnapList = () => {
    const [snapList, vertices] = createSnapList(this.map, draw, line);
    state.vertices = vertices;
    state.snapList = snapList;
  };
  // for removing listener later on close
  state["updateSnapList"] = updateSnapList;
  Object.assign(draw, { updateSnapList });
  const optionsChangedCallBAck = (options) => {
    state.options = options;
  };
  // for removing listener later on close
  state["optionsChangedCallBAck"] = optionsChangedCallBAck;

  // this.map.on("moveend", moveendCallback);
  this.map.on("draw.snap.options_changed", optionsChangedCallBAck);

  return state;
};

SnapLineMode.onClick = function (state) {
  // We save some processing by rounding on click, not mousemove
  const lng = state.snappedLng;
  const lat = state.snappedLat;

  // End the drawing if this click is on the previous position
  // Note: not bothering with 'direction'
  if (state.currentVertexPosition > 0) {
    const lastVertex = state.feature.coordinates[state.currentVertexPosition - 1];

    state.lastVertex = lastVertex;

    if (lastVertex[0] === lng && lastVertex[1] === lat) {
      return this.changeMode(modes.SIMPLE_SELECT, {
        featureIds: [state.feature.id],
      });
    }
  }

  // const point = state.map.project({ lng: lng, lat: lat });

  addPointTovertices(state.map, state.vertices, { lng, lat });

  state.feature.updateCoordinate(state.currentVertexPosition, lng, lat);

  state.currentVertexPosition++;

  state.feature.updateCoordinate(state.currentVertexPosition, lng, lat);
};

SnapLineMode.onMouseMove = function (state, e) {
  state.halfSize = ((state.options.snapOptions && state.options.snapOptions.cacheSize) || 100) / 2;
  const halfCacheSize = state.halfSize - 15;
  const { x, y } = e.point;
  if (!state.prevQueryBbox || (state.prevQueryBbox && !(state.prevQueryBbox[0] < x && state.prevQueryBbox[2] > x && state.prevQueryBbox[1] < y && state.prevQueryBbox[3] > y))) {
    const [snapList, vertices] = createSnapList(state, this._ctx.api, e);

    state.snapList = snapList;

    state.vertices = vertices;

    state.prevQueryBbox = [
      x - halfCacheSize,
      y - halfCacheSize,
      x + halfCacheSize,
      y + halfCacheSize
    ]
  }
  const { lng, lat } = snap(state, e);

  state.feature.updateCoordinate(state.currentVertexPosition, lng, lat);
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

// This is 'extending' DrawLine.toDisplayFeatures
SnapLineMode.toDisplayFeatures = function (state, geojson, display) {
  if (shouldHideGuide(state, geojson)) return;

  // This relies on the the state of SnapLineMode being similar to DrawLine
  DrawLine.toDisplayFeatures(state, geojson, display);
};

// This is 'extending' DrawLine.onStop
SnapLineMode.onStop = function (state) {
  this.deleteFeature(IDS.VERTICAL_GUIDE, { silent: true });
  this.deleteFeature(IDS.HORIZONTAL_GUIDE, { silent: true });

  // remove moveemd callback
  // this.map.off("moveend", state.moveendCallback);

  // This relies on the the state of SnapLineMode being similar to DrawLine
  DrawLine.onStop.call(this, state);
};

export default SnapLineMode;
