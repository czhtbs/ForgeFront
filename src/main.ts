import Phaser from 'phaser';
import './style.css';

class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    this.add
      .text(32, 32, 'ForgeFront · Phase 0', {
        color: '#e8f0f2',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
      })
      .setResolution(1);

    this.add.text(32, 72, 'Simulation and battle systems will be added in later phases.', {
      color: '#9fb3ba',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
    });
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#101820',
  parent: 'app',
  scene: [BootScene],
};

new Phaser.Game(config);
