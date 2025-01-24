import MapboxDraw from "@mapbox/mapbox-gl-draw";
const { geojsonTypes, modes, cursors } = MapboxDraw.constants;
const { doubleClickZoom } = MapboxDraw.lib;
const DrawPolygon = MapboxDraw.modes.draw_polygon;

import {
  addPointTovertices,
  createSnapList,
  getGuideFeature,
  IDS,
  shouldHideGuide,
  snap,
} from "./../utils";
import booleanIntersects from "@turf/boolean-intersects";

const SnapPolygonMode = { ...DrawPolygon };

SnapPolygonMode.onSetup = function (options) {
  const feature = this.newFeature({
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

  this.addFeature(feature);
  this.addFeature(verticalGuide);
  this.addFeature(horizontalGuide);

  const selectedFeatures = this.getSelected();
  this.clearSelectedFeatures();
  doubleClickZoom.disable(this);
  const draw = this._ctx.api;

  const [snapList, vertices] = createSnapList(this.map, draw, polygon);

  // const [snapList, vertices] = createSnapList(this.map, this._ctx.api, polygon);
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
  const state = {
    map: this.map,
    feature,
    polygon: feature,
    prevQueryBbox: null,
    currentVertexPosition: 0,
    targetLayersId,
    selectedFeatures,
    verticalGuide,
    horizontalGuide,
  };

  // Adding default options
  state.options = Object.assign(this._ctx.options, {
    overlap: true,
  });

  const updateSnapList = () => {
    const [snapList, vertices] = createSnapList(
      this.map,
      this._ctx.api,
      polygon
    );
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

  this.map.on("draw.snap.options_changed", optionsChangedCallBAck);

  return state;
};

SnapPolygonMode.onClick = function (state) {
  // We save some processing by rounding on click, not mousemove
  const lng = state.snappedLng;
  const lat = state.snappedLat;

  // End the drawing if this click is on the previous position
  if (state.currentVertexPosition > 0) {
    const lastVertex =
      state.feature.coordinates[0][state.currentVertexPosition - 1];

    state.lastVertex = lastVertex;

    if (lastVertex[0] === lng && lastVertex[1] === lat) {
      return this.changeMode(modes.SIMPLE_SELECT, {
        featureIds: [state.feature.id],
      });
    }
  }

  // const point = state.map.project();

  addPointTovertices(state.map, state.vertices, { lng, lat });

  state.feature.updateCoordinate(`0.${state.currentVertexPosition}`, lng, lat);

  state.currentVertexPosition++;

  state.feature.updateCoordinate(`0.${state.currentVertexPosition}`, lng, lat);
};

SnapPolygonMode.onMouseMove = function (state, e) {
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

  state.feature.updateCoordinate(`0.${state.currentVertexPosition}`, lng, lat);
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

  this.map.off("draw.snap.options_changed", state.optionsChangedCallBAck);

  var userPolygon = state.feature;
  if (state.options.overlap) {
    DrawPolygon.onStop.call(this, state);
    return;
  }
  // if overlap is false, mutate polygon so it doesnt overlap with existing ones
  // get all editable features to check for intersections
  var features = this._ctx.store.getAll();

  try {
    var edited = userPolygon;
    features.forEach(function (feature) {
      if (userPolygon.id === feature.id) return false;
      if (!booleanIntersects(feature, edited)) return;
      edited = turf.difference(edited, feature);
    });
    state.feature.coordinates =
      edited.coordinates || edited.geometry.coordinates;
  } catch (err) {
    // cancel this polygon if a difference cannot be calculated
    DrawPolygon.onStop.call(this, state);
    this.deleteFeature([state.feature.id], { silent: true });
    return;
  }

  // monkeypatch so DrawPolygon.onStop doesn't error
  var rc = state.feature.removeCoordinate;
  state.feature.removeCoordinate = () => {};
  // This relies on the the state of SnapPolygonMode being similar to DrawPolygon
  DrawPolygon.onStop.call(this, state);
  state.feature.removeCoordinate = rc.bind(state.feature);
};

export default SnapPolygonMode;
