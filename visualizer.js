// Three.js and Cannon.js setup
let scene, camera, renderer, world;
let spheres = [];
let sphereBodies = [];
let sphereQueue = [];
let sphereData = [];
let sonic_sent = 0;
let selectedSphereGlobal = null;
let ground;
let room;
let hoveredSphere = null;
let transactionTimes = [];
let groundBody;
let pendingRequest = null;
let lastTime = performance.now();
let lastSphereCreateTime = 0;
let isAnimating = true;
let stopSphereCreation = null;
let stopPolling = null;
const processedBlockHashes = new Set();
const isVisibilitySupported = typeof document.hidden !== "undefined";

// Make sphereQueue globally accessible for real-time count
window.sphereQueue = sphereQueue;

// TX settings
const RPC_URL = "https://rpc.soniclabs.com";
const BLOCK_EXPLORER = "https://sonicscan.org/tx";
const MIN_AMOUNT = 0.1; // Min Sonic
const MAX_AMOUNT = 100000; // Max Sonic
const TPS_WINDOW = 30000; // 30 seconds

// Sphere settings
const MAX_SPHERES = 1000; // Max displayed spheres
const MAX_QUEUE_SIZE = 50000; // Max queue size
const MIN_SPHERE_SIZE = 0.4;
const MAX_SPHERE_SIZE = 10;
const MIN_SPHERE_SEGMENTS = 10; // Resolution
const MAX_SPHERE_SEGMENTS = 40; // Resolution
const BOUNCE_RESTITUTION = 0.4;
const SELECTED_COLOR = 0xb92c89; // Magenta
const GLOW_INTENSITY = 0.2;

// Ground settings
const TILT_START = MAX_SPHERES / 2;  // Start tilting at half max
const MAX_TILT = Math.PI / 30;      // 6 degree in radians max tilt

// Environment settings
 // target fps (higher = more cpu)
const TIME_STEP = 1 / 40;
const MAX_TIME_STEP = 1 / 20;
// down force
const GRAVITY = 9;
// ambient light
const AMBIENT_INTENSITY = 0.8;
// directional light
const DIRECTIONAL_INTENSITY = 1;

// Set up tooltip
const tooltipDiv = document.createElement('div');
tooltipDiv.style.cssText = `
  position: fixed;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  padding: 8px;
  border-radius: 8px;
  font-family: Arial, sans-serif;
  font-size: 14px;
  pointer-events: none;
  display: none;
  z-index: 999;
`;
document.body.appendChild(tooltipDiv);

const isTouchDevice = () => {
  return (('ontouchstart' in window) ||
     (navigator.maxTouchPoints > 0) ||
     (navigator.msMaxTouchPoints > 0));
};

// Add visibility change handler function
function handleVisibilityChange() {
  if (document.hidden) {
    // User left the tab
    console.log('User left the tab');
    pauseSimulation();
  } else {
    // User returned to the tab
    console.log('User returned to the tab');
    resumeSimulation();
  }
}

// Pause all animations and updates
function pauseSimulation() {
  console.log('Pausing simulation');
  isAnimating = false;
  
  // Stop sphere creation loop
  if (stopSphereCreation) {
    stopSphereCreation();
    stopSphereCreation = null;
  }
  
  // Stop polling loop
  if (stopPolling) {
    stopPolling();
    stopPolling = null;
  }
}

// Resume all animations and updates
function resumeSimulation() {
  if (!isAnimating) {
    console.log('Resuming simulation');
    isAnimating = true;
    
    // Restart animation loop
    lastTime = performance.now(); // Reset time delta
    animate();
    
    // Restart sphere creation
    stopSphereCreation = startSphereCreationLoop();
    
    // Restart polling
    stopPolling = pollForNewBlocks();
  }
}

// Add mousemove event listener
function setupMouseHandlers() {
  const canvas = renderer.domElement;
  
  // Use pointerdown instead of click for better cross-device support
  canvas.addEventListener('pointerdown', (event) => onSphereClick(event, canvas));
  
  // Only add hover effects for non-touch devices
  if (!('ontouchstart' in window)) {
    canvas.addEventListener('pointermove', onMouseMove);
    canvas.addEventListener('mouseleave', () => {
      canvas.style.cursor = 'default';
      tooltipDiv.style.display = 'none';
    });
  }
}

// Show transaction details on click on the panel
function onSphereClick(event, canvas) {
  // Get normalized coordinates
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects([...spheres, window.statsHitPlane]);
  const hit = intersects?.[0]?.object;
  
  if (intersects.length > 0) {
    if (hit === window.statsHitPlane && selectedSphereGlobal) {
      navigateToTransaction(selectedSphereGlobal);
    } else if (spheres.includes(hit)) {
      // Reset previous selected sphere color if exists
      if (selectedSphereGlobal && selectedSphereGlobal.sphere) {
        const oldSphere = selectedSphereGlobal.sphere;
        oldSphere.material.emissive.setHex(0x000000);
        oldSphere.material.color.setHex(selectedSphereGlobal.originalColor);
      }
      
      const sphereIndex = spheres.indexOf(hit);
      if (sphereIndex !== -1 && sphereData[sphereIndex]) {
        // Store the original color and sphere reference
        selectedSphere = {
          ...sphereData[sphereIndex],
          sphere: hit,
          originalColor: hit.material.color.getHex()
        };
        
        // Update sphere appearance
        hit.material.color.setHex(SELECTED_COLOR);
        hit.material.emissive.setHex(SELECTED_COLOR);
        hit.material.emissiveIntensity = GLOW_INTENSITY;
        
        if (window.updateStatsDisplay) {
          window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphere);
        }
      }
    }
  }
}

// Add new mousemove handler
function onMouseMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
 
  const intersects = raycaster.intersectObjects([...spheres, window.statsHitPlane]);
  const canvas = renderer.domElement;
 
  if (intersects.length > 0) {
    const hit = intersects[0].object;
   
    if (hit === window.statsHitPlane && selectedSphereGlobal) {
      canvas.style.cursor = 'pointer';
      if (!window.isStatsHovered) {
        window.isStatsHovered = true;
        if (window.updateStatsDisplay) {
          window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
        }
      }
    } else if (spheres.includes(hit)) {
      if (window.isStatsHovered) {
        window.isStatsHovered = false;
        if (window.updateStatsDisplay) {
          window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
        }
      }
      canvas.style.cursor = 'pointer';
      hoveredSphere = hit;
     
      const sphereIndex = spheres.indexOf(hit);
      if (sphereIndex !== -1 && sphereData[sphereIndex]) {
        const amount = sphereData[sphereIndex].amount;
        tooltipDiv.textContent = `${amount.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: amount > 1 ? 0 : 8})} S`;
        tooltipDiv.style.display = 'block';
        tooltipDiv.style.left = `${event.clientX + 15}px`;
        tooltipDiv.style.top = `${event.clientY + 15}px`;
      }
    }
  } else {
    if (window.isStatsHovered) {
      window.isStatsHovered = false;
      if (window.updateStatsDisplay) {
        window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
      }
    }
    canvas.style.cursor = 'default';
    hoveredSphere = null;
    tooltipDiv.style.display = 'none';
  }
}

async function drawExternalLinkIcon(ctx, x, y, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const iconCtx = canvas.getContext('2d');
  
  // Load and draw SVG
  const img = new Image();
  const blob = new Blob([document.querySelector('#external-link').outerHTML], {type: 'image/svg+xml'});
  const url = URL.createObjectURL(blob);
  
  return new Promise((resolve) => {
    img.onload = () => {
      iconCtx.drawImage(img, 0, 0, size, size);
      ctx.drawImage(canvas, x - size/2, y - size/2, size, size);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.src = url;
  });
}

// Add raycaster for click detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function createRoomEnvironment() {
  const roomGeometry = new THREE.BoxGeometry(250, 320, 250);
  roomGeometry.scale(-1, 1, -1);

  // Create gradient texture with dots
  const canvas = document.createElement('canvas');
  canvas.width = 2500;
  canvas.height = 2500;
  const ctx = canvas.getContext('2d');

  // Define colors
  const darkBlue = '#000';
  const brownish = '#492927';
  const peach = '#a97552';

  // Create a more environment-map friendly gradient
  const gradientHeight = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, 0, gradientHeight);
  gradient.addColorStop(1, darkBlue);    // Top
  gradient.addColorStop(0.5, brownish);  // Middle
  gradient.addColorStop(0, peach);       // Bottom
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Add dots to the walls
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  const dotSize = 2.5;
  const spacing = 40;
  
  for (let x = 0; x < canvas.width; x += spacing) {
    for (let y = 0; y < canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Create wall texture
  const wallTexture = new THREE.CanvasTexture(canvas);
  wallTexture.wrapS = THREE.RepeatWrapping;
  wallTexture.wrapT = THREE.RepeatWrapping;
  wallTexture.repeat.set(1, 1);

  // Create the visible room
  const roomMaterial = new THREE.MeshStandardMaterial({
    map: wallTexture,
    side: THREE.BackSide,
    metalness: 0.5,
    roughness: 0.8
  });

  const room = new THREE.Mesh(roomGeometry, roomMaterial);
  room.position.set(0.4, -80, -100);
  scene.add(room);

  // Create environment map texture
  const envTexture = new THREE.CanvasTexture(canvas);
  envTexture.mapping = THREE.EquirectangularReflectionMapping;

  // Generate env map
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envMap = pmremGenerator.fromEquirectangular(envTexture);
  scene.environment = envMap.texture;
  
  pmremGenerator.dispose();
  envTexture.dispose();

  return room;
}

// TPS for stats display
function calculateTPS() {
  const now = Date.now();
  // Remove transactions older than 30 seconds
  transactionTimes = transactionTimes.filter(time => now - time < TPS_WINDOW);
  // Calculate TPS based on remaining transactions
  return (transactionTimes.length / 30).toFixed(2);
}

// Navigate to transaction
function navigateToTransaction(sphere) {
  console.log("Navigating to transaction:", sphere.hash);
  window.open(`${BLOCK_EXPLORER}/${sphere.hash}`, '_blank');
}

// Stats display texture
function createMainStatsTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 520;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
 
  function updateTexture(totalSent, ballCount, tps) {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
   
    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(92, 61, 54, 1)');
    gradient.addColorStop(1, 'rgba(51, 35, 50, 1)');
     
    const borderColor = 'rgb(7, 12, 33)';
    const borderWidth = 5;
     
    // Draw rounded rectangle with border
    const rx = 20;
    const ry = 20;
    const width = canvas.width - 40;
    const height = canvas.height - 40;
    const x = 27;
    const y = 12;
     
    // Draw the border
    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + width - rx, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + ry);
    ctx.lineTo(x + width, y + height - ry);
    ctx.quadraticCurveTo(x + width, y + height, x + width - rx, y + height);
    ctx.lineTo(x + rx, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - ry);
    ctx.lineTo(x, y + ry);
    ctx.quadraticCurveTo(x, y, x + rx, y);
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
     
    // Fill the background
    ctx.fillStyle = gradient;
    ctx.fill();
   
    // Set text properties
    ctx.font = '32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
   
    // Get real-time queue count
    const currentQueueCount = window.sphereQueue ? window.sphereQueue.length : 0;
    
    // Draw stats in white
    const xAdjustment = 6;
    const yAdjustment = canvas.height / 35;
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.fillText(`Volume: ${totalSent.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 4})} S`, canvas.width/2 + xAdjustment, canvas.height/4 - yAdjustment);
    ctx.fillText(`Balls/Queue: ${ballCount}/${currentQueueCount}`, canvas.width/2 + xAdjustment, canvas.height / 2 - yAdjustment);
    ctx.fillText(`TPS: ${tps}`, canvas.width/2 + xAdjustment, canvas.height * 3/4 - yAdjustment);
    
    return new THREE.CanvasTexture(canvas);
  }
  
  const texture = updateTexture(0, 0, '0.00');
  texture.update = updateTexture;
  return texture;
}

function createSelectedTxTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 250;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  
  // Create hit test plane for the link
  const hitTestGeometry = new THREE.PlaneGeometry(1, 1);
  const hitTestMaterial = new THREE.MeshBasicMaterial({ 
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  const hitTestPlane = new THREE.Mesh(hitTestGeometry, hitTestMaterial);
  scene.add(hitTestPlane);
  window.statsHitPlane = hitTestPlane;
  window.isStatsHovered = false;

  // Create base texture
  const texture = new THREE.CanvasTexture(canvas);
  
  // Pre-load the icon to avoid loading it on every update
  const iconImage = new Image();
  const iconBlob = new Blob([document.querySelector('#external-link').outerHTML], {type: 'image/svg+xml'});
  const iconUrl = URL.createObjectURL(iconBlob);
  
  // Wait for icon to load before first render
  iconImage.onload = () => {
    URL.revokeObjectURL(iconUrl);
  };
  iconImage.src = iconUrl;

  // Update function
  function updateTexture(selectedSphere) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(61, 42, 52, 1)');
    gradient.addColorStop(1, 'rgba(45, 31, 44, 1)');
    
    const borderColor = 'rgb(7, 12, 33)';
    const borderWidth = 5;
    
    // Draw rounded rectangle with border
    const rx = 20;
    const ry = 20;
    const width = canvas.width - 40;
    const height = canvas.height - 40;
    const x = 27;
    const y = 12;
    
    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + width - rx, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + ry);
    ctx.lineTo(x + width, y + height - ry);
    ctx.quadraticCurveTo(x + width, y + height, x + width - rx, y + height);
    ctx.lineTo(x + rx, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - ry);
    ctx.lineTo(x, y + ry);
    ctx.quadraticCurveTo(x, y, x + rx, y);
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
    
    ctx.fillStyle = gradient;
    ctx.fill();
    
    ctx.font = '32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    const xAdjustment = 6;
    ctx.fillText('Selected', canvas.width/2 + xAdjustment, canvas.height/3);
    
    if (selectedSphere) {
      const amount = `${selectedSphere.amount.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: selectedSphere.amount > 1 ? 0 : 8})} S`;
      
      ctx.font = '24px Arial';
      ctx.fillStyle = window.isStatsHovered ? '#66d9ff' : '#4A9EFF';
      ctx.fillText(amount, canvas.width/2 + xAdjustment, canvas.height * 2/3.4);
      
      // Draw the pre-loaded icon
      const iconSize = 24;
      ctx.drawImage(iconImage, canvas.width - 30 - iconSize/2, 30 - iconSize/2, iconSize, iconSize);
      
      hitTestPlane.position.set(1.2, 0.8, -223.8);
      hitTestPlane.scale.set(44, 17, 1);
    } else {
      ctx.font = '20px Arial';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText('Click a ball', canvas.width/2 + xAdjustment, canvas.height * 2/3.4);
      
      hitTestPlane.scale.set(0, 0, 0);
    }
    
    texture.needsUpdate = true;
    return texture;
  }
  
  // Initial update
  updateTexture(null);
  
  // Add update method
  texture.update = updateTexture;
  
  return texture;
}

// Stats display
function createStatsDisplay() {
  const mainStatsTexture = createMainStatsTexture();
  const selectedTxTexture = createSelectedTxTexture();
  
  // Create main stats panel
  const mainGeometry = new THREE.PlaneGeometry(50, 20);
  const mainMaterial = new THREE.MeshStandardMaterial({
    map: mainStatsTexture,
    transparent: true,
    opacity: 0.9,
    metalness: 0.5,
    roughness: 0.5
  });

  const mainStatsPlane = new THREE.Mesh(mainGeometry, mainMaterial);
  mainStatsPlane.position.set(0, 30, -224);
  mainStatsPlane.scale.set(2.05, 2.05, 2.05);
  scene.add(mainStatsPlane);

  // Create selected transaction panel
  const selectedGeometry = new THREE.PlaneGeometry(25, 12);
  const selectedMaterial = new THREE.MeshStandardMaterial({
    map: selectedTxTexture,
    transparent: true,
    opacity: 0.9,
    metalness: 0.5,
    roughness: 0.5
  });

  const selectedTxPlane = new THREE.Mesh(selectedGeometry, selectedMaterial);
  selectedTxPlane.position.set(0, -1, -224);
  selectedTxPlane.scale.set(2.05, 2.05, 2.05);
  scene.add(selectedTxPlane);

  // Store reference to update both displays
  window.updateStatsDisplay = (totalSent, ballCount, tps, selectedSphere) => {
    selectedSphereGlobal = selectedSphere;
    
    // Update main stats
    const newMainTexture = mainStatsTexture.update(totalSent, ballCount, tps);
    mainMaterial.map = newMainTexture;
    mainMaterial.needsUpdate = true;
    
    // Update selected transaction
    selectedTxTexture.update(selectedSphere);
    selectedMaterial.needsUpdate = true;
  };
}

// Calculate ground tilt based on sphere count
function calculateTilt(sphereCount) {
  if (sphereCount <= TILT_START) {
    return 0;
  }
  
  // Calculate tilt between 0 and MAX_TILT based on sphere count
  const tiltProgress = (sphereCount - TILT_START) / (MAX_SPHERES - TILT_START);
  return Math.min(tiltProgress * MAX_TILT, MAX_TILT);
}

function createToggleButton() {
  const container = document.getElementById('toggle-container');
 
  // Create toggle wrapper
  const toggleWrapper = document.createElement('div');
  toggleWrapper.className = 'fixed top-4 left-4 flex items-center gap-2 opacity-70';
 
  // Create the switch
  const toggleSwitch = document.createElement('label');
  toggleSwitch.className = 'relative inline-block w-12 h-6';
 
  // Create the checkbox input
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'sr-only';
  checkbox.checked = true;
  
  // Set initial value of ignoreZeroTransactions
  window.ignoreZeroTransactions = !checkbox.checked;
 
  // Create the slider with initial state matching checkbox
  const slider = document.createElement('span');
  slider.className = `absolute cursor-pointer inset-0 rounded-full
    ${checkbox.checked ? 'bg-blue-600' : 'bg-gray-300'} transition-colors duration-200
    before:content-[''] before:absolute before:w-4 before:h-4
    before:left-1 before:bottom-1 before:bg-white before:rounded-full
    before:transition-transform before:duration-200 ${checkbox.checked ? 'before:translate-x-6' : ''}`;
 
  // Create label text with consistent font styling
  const label = document.createElement('span');
  // Set initial color based on checkbox state
  label.className = `font-semibold text-sm ${checkbox.checked ? 'text-blue-400' : 'text-white'}`;
  label.textContent = '0-txs';
 
  // Add click handler
  checkbox.addEventListener('change', () => {
    window.ignoreZeroTransactions = !checkbox.checked;
   
    // Update slider appearance
    if (checkbox.checked) {
      slider.className = `absolute cursor-pointer inset-0 rounded-full
        bg-blue-600 transition-colors duration-200
        before:content-[''] before:absolute before:w-4 before:h-4
        before:left-1 before:bottom-1 before:bg-white before:rounded-full
        before:transition-transform before:duration-200 before:translate-x-6`;
      // Update only the text color class
      label.className = 'font-semibold text-sm text-blue-400';
    } else {
      slider.className = `absolute cursor-pointer inset-0 rounded-full
        bg-gray-300 transition-colors duration-200
        before:content-[''] before:absolute before:w-4 before:h-4
        before:left-1 before:bottom-1 before:bg-white before:rounded-full
        before:transition-transform before:duration-200`;
      // Update only the text color class
      label.className = 'font-semibold text-sm text-white';
    }
  });
 
  // Assemble the toggle
  toggleSwitch.appendChild(checkbox);
  toggleSwitch.appendChild(slider);
  toggleWrapper.appendChild(toggleSwitch);
  toggleWrapper.appendChild(label);
  container.appendChild(toggleWrapper);
}

// Initialize the scene
async function init() {
  // Create Three.js scene
  scene = new THREE.Scene();
  scene.background = null;

  // Setup camera
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 20, 70);
  camera.lookAt(0, 0, 0);

  // Setup renderer - MUST come before creating room
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.domElement.style.cursor = 'pointer';
  document.body.appendChild(renderer.domElement);

  // Create room - NOW after renderer is initialized
  room = createRoomEnvironment();
  createStatsDisplay();

  // Rest of the init function remains the same...
  const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffead2, DIRECTIONAL_INTENSITY);
  directionalLight.position.set(15, 25, 20);
  directionalLight.castShadow = false;
  scene.add(directionalLight);

  // Initialize physics world
  world = new CANNON.World();
  world.gravity.set(0, -GRAVITY, 0);
  // world.allowSleep = true;

  // Create ground
  await createGround();

  // Create toggle button
  createToggleButton();

  // Detect on click
  setupMouseHandlers();

  // Start all animations
  isAnimating = true;
  animate();
  stopSphereCreation = startSphereCreationLoop();
  stopPolling = pollForNewBlocks();

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);

  // Handle visibility change
  /** Does not seem to trigger for some reason
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, setting up visibility handler');
    document.addEventListener("visibilitychange", handleVisibilityChange, false);
  });
  */
  
  // Add cleanup on page unload
  /** Does not seem to trigger for some reason
  window.addEventListener('beforeunload', cleanup);
  */
}

// Ground logo texture
function createLogoTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  // Create base color
  ctx.fillStyle = '#0048b2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Load and draw SVG
  const img = new Image();
  const blob = new Blob([document.querySelector('#platform-logo').outerHTML], {type: 'image/svg+xml'});
  const url = URL.createObjectURL(blob);
  
  return new Promise((resolve) => {
    img.onload = () => {
      // Draw the logo at 80% size, centered
      const size = canvas.width * 0.9;
      const x = (canvas.width - size) / 2;
      const y = (canvas.height - size) / 2;
      ctx.drawImage(img, x, y, size, size);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      URL.revokeObjectURL(url);
      resolve(texture);
    };
    img.src = url;
  });
}

// Create ground plane
async function createGround() {
  // Physics ground
  const width = window.innerWidth < 1000 ? window.innerWidth / 30 : 25;
  const height = 2;
  const depth = 25;
  const groundShape = new CANNON.Box(new CANNON.Vec3(width, height, depth));
  groundBody = new CANNON.Body({ // global var for reference
    mass: 0,
    shape: groundShape,
    material: new CANNON.Material({
      restitution: BOUNCE_RESTITUTION,
    })
  });

  /**
  // Configure ground for better collision handling
  groundBody.collisionResponse = true;
  
  // Add contact material between spheres and ground
  const groundMaterial = new CANNON.Material();
  const sphereMaterial = new CANNON.Material();
  
  const contactMaterial = new CANNON.ContactMaterial(groundMaterial, sphereMaterial, {
    friction: 0.3,
    restitution: BOUNCE_RESTITUTION,
    contactEquationStiffness: 1e8,    // Increase stiffness for better collision response
    contactEquationRelaxation: 3,     // Relaxation for stability
  });
  
  world.addContactMaterial(contactMaterial);
  groundBody.material = groundMaterial;
  */
  
  groundBody.position.set(0, -8, 0);
  world.add(groundBody);

  // Create two materials: one for top (with logo) and one for sides
  const logoTexture = await createLogoTexture();
  
  const topMaterial = new THREE.MeshStandardMaterial({
    color: 0x0048b2,
    metalness: 0.95,
    roughness: 0.05,
    envMapIntensity: 2,
    map: logoTexture
  });

  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x0048b2,
    metalness: 0.95,
    roughness: 0.05,
    envMapIntensity: 2
  });

  // Create an array of materials for each face
  // Order: right, left, top, bottom, front, back
  const materials = [
    sideMaterial,    // right
    sideMaterial,    // left
    topMaterial,     // top
    sideMaterial,    // bottom
    sideMaterial,    // front
    sideMaterial     // back
  ];

  // Create geometry and mesh with multiple materials
  const geometry = new THREE.BoxGeometry(width * 2, height * 2, depth * 2);
  ground = new THREE.Mesh(geometry, materials);
  ground.position.copy(groundBody.position);
  ground.receiveShadow = false;
  scene.add(ground);
}

// Create a sphere based on transaction amount
function createSphere(amount, txHash) {
  // Scale the size based on amount (MIN_AMOUNT = smallest, MAX_AMOUNT = largest)
  const logMin = Math.log10(MIN_AMOUNT);
  const logMax = Math.log10(MAX_AMOUNT);
  const logAmount = Math.log10(Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, amount)));
  
  // Get basic 0-1 normalization
  const normalizedSize = (logAmount - logMin) / (logMax - logMin);
  
  // Apply cubic power to favor smaller sizes
  // Higher power = more small spheres, fewer large ones
  const weightedSize = Math.pow(normalizedSize, 3);
  
  // Map to final size range (0.4 to 12.4)
  const size = MIN_SPHERE_SIZE + (weightedSize * MAX_SPHERE_SIZE);
  
  // Rest of the createSphere function remains the same...
  // Dynamically less bouncy for large spheres
  const restitution = (Math.log10(size) - Math.log10(MIN_SPHERE_SIZE)) / (Math.log10(MAX_SPHERE_SIZE) - Math.log10(MIN_SPHERE_SIZE));
  const dynamicRestitution = BOUNCE_RESTITUTION * (1 - restitution);

  const sphereShape = new CANNON.Sphere(size);
  const sphereBody = new CANNON.Body({
    mass: Math.pow(size, 3), // sphere volume
    shape: sphereShape,
    material: new CANNON.Material({
      restitution: dynamicRestitution,
    }),
    // linearDamping: 0.01,      // Add slight damping to prevent endless bouncing
    // allowSleep: true,         // Allow bodies to sleep when static
    // collisionResponse: true,  // Ensure collisions are processed
    // sleepSpeedLimit: 5,   // Bodies sleep when moving slower than this
    // sleepTimeLimit: 1.0,      // Bodies must be still for this long before sleeping
  });
  
  // Random position above the scene with more height variation
  // Use lower x range on mobile
  const xRange = window.innerWidth < 800 ? 20 : 30;
  sphereBody.position.set(
    (Math.random() - 0.5) * xRange,  // x: -15 to 15
    50 + (Math.random() * 30),   // y: 50 to 80
    (Math.random() - 0.5) * 30   // z: -15 to 15
  );
  
  world.add(sphereBody);
  sphereBodies.push(sphereBody);

  // Determine sphere color based on amount
  let sphereColor;

  // Get normalized value between 0 and 1 based on amount
  let normalizedAmount;
  if (amount === 0) {
    normalizedAmount = 0;
  } else {
    normalizedAmount = (logAmount - logMin) / (logMax - logMin);
  }

  // Calculate segments - scale between min and max segments
  const segmentSize = Math.round(MIN_SPHERE_SEGMENTS + (normalizedAmount * (MAX_SPHERE_SEGMENTS - MIN_SPHERE_SEGMENTS)));
  if (amount > 1) {
    console.info(`${amount} S at ${txHash}`);
  }

  // Set colors based on amount thresholds
  if (amount === 0) {
    sphereColor = 0x2a0029; // black
  } else if (amount < 1) {
    sphereColor = 0xcc2222; // red
  } else if (amount <= 1000) {
    sphereColor = 0xca6749; // orange
  } else if (amount <= 100000) {
    sphereColor = 0x1c368b; // blue
  } else {
    sphereColor = 0x378c2b; // green
  }

  const geometry = new THREE.SphereGeometry(size, segmentSize, segmentSize);

  const material = new THREE.MeshStandardMaterial({
    color: sphereColor,
    metalness: 0.9,
    roughness: 0.3,
    envMapIntensity: 1,
    emissive: 0x000000,      // Add emissive for glow
    emissiveIntensity: 0,    // Start with no glow
  });
  
  const sphere = new THREE.Mesh(geometry, material);
  sphere.castShadow = false;
  sphere.receiveShadow = false;
  scene.add(sphere);
  spheres.push(sphere);
  sphereData.push({ hash: txHash, amount: amount });

  // Clean up old spheres if too many
  /**
   * Not needed if we only add at a certain rate and never go beyond MAX_SPHERES
  if (spheres.length > MAX_SPHERES) {
    const oldSphere = spheres.shift();
    const oldBody = sphereBodies.shift();
    sphereData.shift(); // Remove corresponding transaction data
    oldSphere.geometry.dispose();
    oldSphere.material.dispose();
    scene.remove(oldSphere);
    world.remove(oldBody);
  }
  */
}

// RPC Functions
async function fetchRPC(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return data.result;
}

async function getLatestBlocksAndTransactions() {
  if (pendingRequest) {
    return null;
  }
  
  try {
    pendingRequest = true;
    
    // First get block number
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: []
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const { result: blockNumberHex } = await response.json();
    const latestBlockNumber = parseInt(blockNumberHex, 16);
    
    // Get last 4 blocks in one batch call
    // To make sure we don't miss any blocks when rpc is slow
    const blocksResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getBlockByNumber',
          params: [`0x${(latestBlockNumber - 3).toString(16)}`, true]
        },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'eth_getBlockByNumber',
          params: [`0x${(latestBlockNumber - 2).toString(16)}`, true]
        },
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'eth_getBlockByNumber',
          params: [`0x${(latestBlockNumber - 1).toString(16)}`, true]
        },
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'eth_getBlockByNumber',
          params: [`0x${latestBlockNumber.toString(16)}`, true]
        }
      ])
    });

    if (!blocksResponse.ok) {
      throw new Error(`HTTP error! status: ${blocksResponse.status}`);
    }

    const blocksData = await blocksResponse.json();
    
    // Process all blocks from the batch response
    const newTransactions = [];
    
    for (const result of blocksData) {
      const block = result.result;
      if (!block) continue;

      // Skip if we've already processed this block
      if (processedBlockHashes.has(block.hash)) {
        continue;
      }

      // console.info(parseInt(block.number, 16));
      processedBlockHashes.add(block.hash);

      // Keep set size manageable
      if (processedBlockHashes.size > 50) {
        const oldestHash = processedBlockHashes.values().next().value;
        processedBlockHashes.delete(oldestHash);
      }

      // Add transactions from this block
      if (block.transactions?.length > 0) {
        newTransactions.push(...block.transactions.map(tx => ({
          hash: tx.hash,
          amount: parseInt(tx.value, 16) / 1e18,
          subtype: tx.to ? 'send' : 'contract_creation',
          blockHash: block.hash,
          blockNumber: parseInt(block.number, 16)
        })));
      }
    }

    return newTransactions.length > 0 ? newTransactions : null;

  } catch (error) {
    console.error('Error fetching blockchain data:', error);
    return null;
  } finally {
    pendingRequest = null;
  }
}

function pollForNewBlocks() {
  let isPolling = true;

  async function poll() {
    if (!isPolling) return;

    const transactions = await getLatestBlocksAndTransactions();
    if (transactions) {
      transactions.forEach(processTransaction);
    }

    setTimeout(poll, 600);
  }

  poll();
  return () => {
    isPolling = false;
  };
}

function processTransaction(txData) {
  // Check if we should ignore this transaction
  if (window.ignoreZeroTransactions && txData.amount <= 0.000000000000000001) {
    return;
  }
  
  // Add to total Sonic sent
  sonic_sent += txData.amount;
  
  // Add to queue if not full
  if (sphereQueue.length < MAX_QUEUE_SIZE) {
    sphereQueue.push(txData);
  }
  
  // Record transaction time for TPS calculation
  transactionTimes.push(Date.now());
  
  // Update stats display immediately after queue change
  if (window.updateStatsDisplay) {
    requestAnimationFrame(() => {
      window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
    });
  }
}


// Separate loop for sphere creation
function startSphereCreationLoop() {
  let isRunning = true;
  const SPHERES_PER_BATCH = 10;
  const CREATION_RATE = 25; // per second
  const MIN_BATCH_INTERVAL = 1000 / CREATION_RATE;

  async function createSphereFromQueue() {
    if (!isRunning) return;

    const currentTime = performance.now();

    if (sphereQueue.length > 0 && spheres.length < MAX_SPHERES) {
      if (currentTime - lastSphereCreateTime >= MIN_BATCH_INTERVAL) {
        // Create up to 10 spheres per batch, or however many are in queue
        const spheresToCreate = Math.min(
          SPHERES_PER_BATCH,
          sphereQueue.length,
          MAX_SPHERES - spheres.length
        );

        for (let i = 0; i < spheresToCreate; i++) {
          const txData = sphereQueue.shift();
          createSphere(txData.amount, txData.hash);
        }
        
        lastSphereCreateTime = currentTime;
        
        if (window.updateStatsDisplay && currentTime - lastSphereCreateTime >= 500) {
          window.updateStatsDisplay(sonic_sent, spheres.length, calculateTPS(), selectedSphereGlobal);
        }
      }
    }

    requestAnimationFrame(createSphereFromQueue);
  }

  createSphereFromQueue();
  return () => {
    isRunning = false;
  };
}

// Total cleanup function (for page unload)
function cleanup() {
  console.log('Cleaning up resources...');
  pauseSimulation();
  
  // Clean up existing spheres
  spheres.forEach(sphere => {
    sphere.geometry.dispose();
    sphere.material.dispose();
    scene.remove(sphere);
  });
  
  sphereBodies.forEach(body => {
    world.remove(body);
  });
  
  // Clear arrays
  spheres = [];
  sphereBodies = [];
  sphereData = [];
  sphereQueue = [];
  
  // Clean up Three.js resources
  renderer.dispose();
}

function animate() {
  if (!isAnimating) return;
  
  requestAnimationFrame(animate);
  
  // Calculate delta time
  const currentTime = performance.now();
  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  
  // Calculate current tilt
  const tiltAngle = calculateTilt(spheres.length);
  
  // Update ground rotation
  if (ground && ground.position.y !== undefined) {
    // Adjust the rotation point to be at the surface center
    const heightOffset = 2;
    // Move ground up by height, rotate, then move back down
    ground.position.y = groundBody.position.y + heightOffset;
    ground.rotation.x = tiltAngle;
    ground.position.z = -Math.sin(tiltAngle) * heightOffset;
    ground.position.y -= Math.cos(tiltAngle) * heightOffset;
    // Update physics body rotation
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tiltAngle);
  }
  
  // Step physics simulation
  // world.step(FIXED_TIME_STEP, deltaTime, MAX_SUB_STEPS);
  world.step(Math.min(TIME_STEP * (deltaTime / 7), MAX_TIME_STEP));
  world.solver.iterations = 5;
  
  // Update sphere positions
  for (let i = 0; i < spheres.length; i++) {
    spheres[i].position.copy(sphereBodies[i].position);
    spheres[i].quaternion.copy(sphereBodies[i].quaternion);
  }
  
  // Clean up fallen spheres
  for (let i = spheres.length - 1; i >= 0; i--) {
    if (spheres[i].position.y < -70) {
      spheres[i].geometry.dispose();
      spheres[i].material.dispose();
      scene.remove(spheres[i]);
      world.remove(sphereBodies[i]);
      spheres.splice(i, 1);
      sphereBodies.splice(i, 1);
      sphereData.splice(i, 1);
    }
  }
  
  renderer.render(scene, camera);
}

// Window resize handler
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Initialize everything
init();