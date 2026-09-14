import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
} from "react-native";
import { Accelerometer } from "expo-sensors";
import { StatusBar } from "expo-status-bar";

const SAMPLE_INTERVAL_MS = 20; // ~50 Hz
const LIVE_WINDOW = 40;
const CAPTURE_SAMPLES = 250;
const STABLE_SD_LIMIT = 0.06;
const DEFAULT_TOLERANCE = 0.05;

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 999;

  const avg = mean(values);
  const variance =
    values.reduce((sum, n) => sum + Math.pow(n - avg, 2), 0) /
    values.length;

  return Math.sqrt(variance);
}

function trimmedMean(values, trimPercent = 0.1) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);

  const trim = Math.floor(sorted.length * trimPercent);

  const trimmed =
    trim > 0 ? sorted.slice(trim, sorted.length - trim) : sorted;

  return mean(trimmed);
}

// Phone placement:
// portrait orientation
// top of phone pointing upward
// screen facing away from the wheel / toward technician
//
// This converts gravity into a side-to-side inclination angle.
function calculateCamberAngle({ x, y, z }) {
  const denominator = Math.sqrt(y * y + z * z);

  if (denominator === 0) return 0;

  return Math.atan2(x, denominator) * (180 / Math.PI);
}

function Button({ title, onPress, disabled = false, secondary = false }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && styles.secondaryButtonText,
          disabled && styles.disabledButtonText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function HomeScreen({ setScreen }) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.logo}>Alignpro</Text>
      <Text style={styles.subtitle}>Precision Wheel Alignment</Text>

      <View style={styles.homeCard}>
        <Text style={styles.homeIcon}>◉</Text>
        <Text style={styles.homeTitle}>Camber</Text>
        <Text style={styles.homeDescription}>
          Measure two wheels and match their angles.
        </Text>

        <Button title="Measure Camber" onPress={() => setScreen("camber")} />
      </View>

      <View style={styles.homeCard}>
        <Text style={styles.homeIcon}>↔</Text>
        <Text style={styles.homeTitle}>Toe</Text>
        <Text style={styles.homeDescription}>
          Relative toe measurement using a physical reference.
        </Text>

        <Button title="Toe Setup" onPress={() => setScreen("toe")} />
      </View>

      <View style={styles.homeCard}>
        <Text style={styles.homeIcon}>◎</Text>
        <Text style={styles.homeTitle}>Calibration</Text>
        <Text style={styles.homeDescription}>
          Check sensor stability and configure fixture direction.
        </Text>

        <Button
          title="Calibration"
          secondary
          onPress={() => setScreen("calibration")}
        />
      </View>
    </ScrollView>
  );
}

function PlacementGuide() {
  return (
    <View style={styles.guideCard}>
      <Text style={styles.sectionTitle}>Phone Placement</Text>

      <Text style={styles.guideText}>
        1. Install phone firmly in the Alignpro wheel fixture.
      </Text>

      <Text style={styles.guideText}>
        2. Keep phone vertical with the top pointing upward.
      </Text>

      <Text style={styles.guideText}>
        3. Use the same fixture position on both wheels.
      </Text>

      <Text style={styles.guideText}>
        4. Do not press the phone directly against wheel spokes.
      </Text>

      <Text style={styles.guideText}>
        5. Wait for STABLE before capturing a measurement.
      </Text>
    </View>
  );
}

function CamberScreen({
  liveAngle,
  rawAngle,
  stability,
  stable,
  captureProgress,
  captureTarget,
  captureWheel,
  leftReading,
  rightReading,
  clearMeasurements,
  zeroSensor,
  referenceSide,
  setReferenceSide,
  arrowFlipped,
  tolerance,
  setScreen,
}) {
  const reference =
    referenceSide === "left" ? leftReading : rightReading;

  const current =
    referenceSide === "left" ? rightReading : leftReading;

  const bothMeasured =
    leftReading !== null && rightReading !== null;

  let difference = null;
  let correction = null;
  let matched = false;
  let direction = null;

  if (bothMeasured) {
    difference = current - reference;
    correction = reference - current;
    matched = Math.abs(correction) <= tolerance;

    if (!matched) {
      const needsIncrease = correction > 0;

      if (!arrowFlipped) {
        direction = needsIncrease ? "RIGHT" : "LEFT";
      } else {
        direction = needsIncrease ? "LEFT" : "RIGHT";
      }
    }
  }

  const arrow =
    direction === "RIGHT"
      ? "→"
      : direction === "LEFT"
      ? "←"
      : "✓";

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable onPress={() => setScreen("home")}>
        <Text style={styles.back}>‹ Home</Text>
      </Pressable>

      <Text style={styles.pageTitle}>Camber</Text>

      <PlacementGuide />

      <View style={styles.liveCard}>
        <Text style={styles.label}>LIVE ANGLE</Text>

        <Text style={styles.liveAngle}>
          {liveAngle >= 0 ? "+" : ""}
          {liveAngle.toFixed(2)}°
        </Text>

        <Text
          style={[
            styles.stabilityText,
            stable ? styles.greenText : styles.redText,
          ]}
        >
          {stable ? "● STABLE" : "● HOLD STILL"}
        </Text>

        <Text style={styles.smallText}>
          Sensor variation ±{stability.toFixed(3)}°
        </Text>
      </View>

      {captureTarget !== null && (
        <View style={styles.captureCard}>
          <Text style={styles.captureTitle}>
            Capturing {captureTarget === "left" ? "LEFT" : "RIGHT"} wheel
          </Text>

          <Text style={styles.captureProgress}>
            {captureProgress} / {CAPTURE_SAMPLES}
          </Text>

          <Text style={styles.smallText}>
            Keep fixture completely still
          </Text>
        </View>
      )}

      <View style={styles.twoColumns}>
        <View style={styles.wheelCard}>
          <Text style={styles.wheelTitle}>LEFT WHEEL</Text>

          <Text style={styles.wheelReading}>
            {leftReading === null
              ? "--.--°"
              : `${leftReading >= 0 ? "+" : ""}${leftReading.toFixed(2)}°`}
          </Text>

          <Button
            title="Capture Left"
            disabled={!stable || captureTarget !== null}
            onPress={() => captureWheel("left")}
          />
        </View>

        <View style={styles.wheelCard}>
          <Text style={styles.wheelTitle}>RIGHT WHEEL</Text>

          <Text style={styles.wheelReading}>
            {rightReading === null
              ? "--.--°"
              : `${rightReading >= 0 ? "+" : ""}${rightReading.toFixed(2)}°`}
          </Text>

          <Button
            title="Capture Right"
            disabled={!stable || captureTarget !== null}
            onPress={() => captureWheel("right")}
          />
        </View>
      </View>

      <View style={styles.referenceCard}>
        <Text style={styles.sectionTitle}>Reference Wheel</Text>

        <View style={styles.referenceButtons}>
          <Pressable
            style={[
              styles.referenceButton,
              referenceSide === "left" &&
                styles.referenceButtonSelected,
            ]}
            onPress={() => setReferenceSide("left")}
          >
            <Text style={styles.referenceButtonText}>LEFT</Text>
          </Pressable>

          <Pressable
            style={[
              styles.referenceButton,
              referenceSide === "right" &&
                styles.referenceButtonSelected,
            ]}
            onPress={() => setReferenceSide("right")}
          >
            <Text style={styles.referenceButtonText}>RIGHT</Text>
          </Pressable>
        </View>
      </View>

      {bothMeasured && (
        <View
          style={[
            styles.correctionCard,
            matched
              ? styles.correctionGood
              : styles.correctionBad,
          ]}
        >
          <Text style={styles.correctionLabel}>
            CORRECTION NEEDED
          </Text>

          <Text
            style={[
              styles.bigArrow,
              matched ? styles.greenText : styles.redText,
            ]}
          >
            {arrow}
          </Text>

          {matched ? (
            <>
              <Text style={[styles.correctionDirection, styles.greenText]}>
                MATCH
              </Text>

              <Text style={styles.correctionAmount}>
                Difference {Math.abs(difference).toFixed(2)}°
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.correctionDirection, styles.redText]}>
                MOVE TOP {direction}
              </Text>

              <Text style={styles.correctionAmount}>
                {Math.abs(correction).toFixed(2)}°
              </Text>

              <Text style={styles.smallText}>
                Adjust the non-reference wheel until the display turns green.
              </Text>
            </>
          )}
        </View>
      )}

      <View style={styles.actionsCard}>
        <Button title="Zero / Calibrate" secondary onPress={zeroSensor} />

        <Button
          title="Clear Measurements"
          secondary
          onPress={clearMeasurements}
        />
      </View>

      <Text style={styles.disclaimer}>
        0.01° is display resolution, not validated absolute accuracy.
        Accuracy will be established through repeated fixture testing and
        comparison with professional alignment equipment.
      </Text>
    </ScrollView>
  );
}

function ToeScreen({ setScreen }) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable onPress={() => setScreen("home")}>
        <Text style={styles.back}>‹ Home</Text>
      </Pressable>

      <Text style={styles.pageTitle}>Toe</Text>

      <View style={styles.guideCard}>
        <Text style={styles.sectionTitle}>Precision Toe Mode</Text>

        <Text style={styles.guideText}>
          Toe will not use the magnetic compass.
        </Text>

        <Text style={styles.guideText}>
          The wheel fixture will be zeroed against a common physical reference
          before each wheel measurement.
        </Text>

        <Text style={styles.guideText}>
          This prevents vehicle metal from corrupting magnetic heading
          measurements.
        </Text>

        <Text style={styles.comingSoon}>
          Physical-reference toe measurement is the next module.
        </Text>
      </View>
    </ScrollView>
  );
}

function CalibrationScreen({
  setScreen,
  liveAngle,
  rawAngle,
  stability,
  stable,
  zeroSensor,
  arrowFlipped,
  setArrowFlipped,
}) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Pressable onPress={() => setScreen("home")}>
        <Text style={styles.back}>‹ Home</Text>
      </Pressable>

      <Text style={styles.pageTitle}>Calibration</Text>

      <View style={styles.liveCard}>
        <Text style={styles.label}>CORRECTED ANGLE</Text>
        <Text style={styles.calValue}>{liveAngle.toFixed(3)}°</Text>

        <Text style={styles.label}>RAW SENSOR ANGLE</Text>
        <Text style={styles.calValue}>{rawAngle.toFixed(3)}°</Text>

        <Text style={styles.label}>SHORT-TERM VARIATION</Text>
        <Text style={styles.calValue}>±{stability.toFixed(3)}°</Text>

        <Text
          style={[
            styles.stabilityText,
            stable ? styles.greenText : styles.redText,
          ]}
        >
          {stable ? "SENSOR STABLE" : "MOVEMENT DETECTED"}
        </Text>
      </View>

      <Button title="Zero Sensor" onPress={zeroSensor} />

      <View style={styles.guideCard}>
        <Text style={styles.sectionTitle}>Correction Arrow Direction</Text>

        <Text style={styles.guideText}>
          Once the physical fixture is built, tilt it slightly in a known
          direction to verify that Alignpro's arrows correspond to the actual
          wheel movement.
        </Text>

        <Button
          title={
            arrowFlipped
              ? "Arrow Mapping: FLIPPED"
              : "Arrow Mapping: NORMAL"
          }
          secondary
          onPress={() => setArrowFlipped(!arrowFlipped)}
        />
      </View>
    </ScrollView>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");

  const [liveAngle, setLiveAngle] = useState(0);
  const [rawAngle, setRawAngle] = useState(0);
  const [stability, setStability] = useState(999);
  const [stable, setStable] = useState(false);

  const [leftReading, setLeftReading] = useState(null);
  const [rightReading, setRightReading] = useState(null);

  const [referenceSide, setReferenceSide] = useState("left");

  const [captureTarget, setCaptureTarget] = useState(null);
  const [captureProgress, setCaptureProgress] = useState(0);

  const [arrowFlipped, setArrowFlipped] = useState(false);

  const zeroOffsetRef = useRef(0);

  const liveBufferRef = useRef([]);
  const captureBufferRef = useRef([]);
  const captureTargetRef = useRef(null);

  const filteredRawRef = useRef(0);

  useEffect(() => {
    let subscription;

    async function startSensor() {
      const available = await Accelerometer.isAvailableAsync();

      if (!available) {
        return;
      }

      Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);

      subscription = Accelerometer.addListener((sensorData) => {
        const angle = calculateCamberAngle(sensorData);

        setRawAngle(angle);

        liveBufferRef.current.push(angle);

        if (liveBufferRef.current.length > LIVE_WINDOW) {
          liveBufferRef.current.shift();
        }

        if (liveBufferRef.current.length < 10) {
          return;
        }

        const
