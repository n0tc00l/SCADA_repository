class ValveSystem {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'valve-container';
    document.body.appendChild(this.container);

    // Динамически подключаем стили
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    //link.href = 'styles/valves.css';
    link.href = 'styles.css';

    document.head.appendChild(link);

    this.loadSVG();
  }

  async loadSVG() {
    try {
      document.addEventListener('alpine:init', () => {
        Alpine.store('statusFormatter', {
          getText(status) {
            const map = {
              0: 'закрыта',
              1: 'открыта',
              2: 'закрывается',
              3: 'открывается',
              4: 'промежуточное'
            };
            return map[status] || 'неизвестный статус';
          }
        });
        Alpine.store('tubeUtils', {
          getGradientId(status, gradientType) {
            const map = {
              0: 'Gray',
              1: 'Blue',
              3: 'Cyan',

            };
            return `#${gradientType}Gradient${map[status] || 'Red'}Color`;
          }
        });
      });


      const response = await fetch('assets/svg/oiltest2.xml');
      this.container.innerHTML = await response.text();
      this.initValves();
      //Добавим в alpine фукнцию	  




      this.initTube(0);
      this.initTube(1);
    } catch (error) {
      console.error('Ошибка загрузки SVG:', error);
      this.container.innerHTML = '<p style="color:red;padding:20px;">Ошибка загрузки SVG</p>';
    }
  }

  initValves() {
    console.log('1');
    document.querySelectorAll('[id$="_vlv01"]').forEach(btn => {
      console.log(btn.id);
      const valveId = btn.id.replace('_vlv01', '');
      new Valve(valveId, '1');
    });

    console.log('2');
    document.querySelectorAll('[id$="_vlv02"]').forEach(btn => {
      console.log(btn.id);
      const valveId = btn.id.replace('_vlv02', '');
      new Valve(valveId, '2');
    });
  }


  initTube(gradientTypeCode) {
    let gradientType = ".scadaTubeLinear";
    let gradientType_ = "linear";
    if (gradientTypeCode == 1) {
      gradientType = ".scadaTubeRadial";
      gradientType_ = "radial";
    };


    console.log('Initializing tubes...');

    document.querySelectorAll(gradientType).forEach(el => {
      console.log('Processing tube:', el.id);

      // Проверяем наличие обязательных data-атрибутов
      if (!el.dataset.tagname || !el.dataset.visibleValue) {
        console.warn(`Tube ${el.id} is missing required data attributes`);
        return;
      }

      try {
        const valveId = el.dataset.tagname;

        el.removeAttribute('href');
        el.removeAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href');

        // Инициализация Alpine
        if (!el._x_isAlpine) {
          Alpine.initTree(el);
        }

        // Устанавливаем реактивные атрибуты
        const s = `{valveId: '${valveId}',get gradient() {return $store.tubeUtils.getGradientId($store.v.${valveId}_STATUS,"${gradientType_}");}}`;
        console.log(s);
        el.setAttribute('x-data', s);

        // Двойная привязка для совместимости
        el.setAttribute('x-bind:href', 'gradient');
        el.setAttribute('x-bind:xlink:href', 'gradient');
        el.setAttribute('x-effect', 'console.log("Gradient updated:", gradient)');


      } catch (error) {
        console.error(`Error processing tube ${el.id}:`, error);
      }
    });


    console.log('Tube initialization complete');
  }
}

class Valve {
  constructor(id, typeZ) {
    console.log("задвижка:" + id)
    this.id = id;
    this.state = 'closed';
    this.btn = document.getElementById(`${id}_vlv0${typeZ}`);
    this.svgElement = document.getElementById(id);
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };

    this.createModal();
    this.setupEvents();
    //Зададим класс отображения
    const el = document.getElementById(`${id}_1`);
    const el1 = document.getElementById(`${id}_2`);
    const s = `{css_vlv01_00: $store.v.${this.id}_STATUS===0, css_vlv01_01: $store.v.${this.id}_STATUS===1, css_vlv01_02: $store.v.${this.id}_STATUS===2, css_vlv01_03: $store.v.${this.id}_STATUS===3, css_vlv01_04: $store.v.${this.id}_STATUS===4}`
    if (el) {
      el.setAttribute('x-data', '{}');
      el.setAttribute(':class', s);
    }

    if (el1) {
      el1.setAttribute('x-data', '{}');
      el1.setAttribute(':class', s);
    }

  }

  createModal() {
    this.modal = document.createElement('div');
    this.modal.className = 'valve-modal';
    this.modal.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">${this.id}</span>
      <button class="modal-close-btn">&times;</button>
      </div>
      <div class="modal-content">
        <div>Степень открытия: <b><span x-text="$store.v.${this.id}_POS">{}</span></b></div>
		<div>Код: <span x-text="$store.v.${this.id}_STATUS">{}</span></div>
		<div>Статус: <b><span x-text="$store.statusFormatter.getText($store.v.${this.id}_STATUS)">{}</span></b></div>
		<div>Статус: <b><span x-text="$store.tubeUtils.getGradientId($store.v.${this.id}_STATUS)">{}</span></b></div>
        <div class="modal-buttons">
          <button class="action-btn open-btn">Открыть</button>
          <button class="action-btn stop-btn">Стоп</button>
		  <button class="action-btn close-btn">Закрыть</button>
		  
        </div>
      </div>
    `;


    document.body.appendChild(this.modal);
  }

  setupEvents() {
    // Клик по кнопке в SVG
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openModal(e);
    });

    // Кнопки управления
    this.modal.querySelector('.open-btn').addEventListener('click', () => {
      this.setState('open');
    });

    this.modal.querySelector('.close-btn').addEventListener('click', () => {
      this.setState('close');
    });

    this.modal.querySelector('.stop-btn').addEventListener('click', () => {
      this.setState('stop');
    });

    this.modal.querySelector('.modal-close-btn').addEventListener('click', () => {
      //console.log("close");
      this.modal.style.display = 'none'; // Ваша функция закрытия модального окна
    });

    // Перетаскивание окна
    const header = this.modal.querySelector('.modal-header');
    header.addEventListener('mousedown', (e) => this.startDrag(e));
    document.addEventListener('mousemove', (e) => this.dragModal(e));
    document.addEventListener('mouseup', () => this.stopDrag());
  }

  openModal(e) {
    this.modal.style.display = 'block';
    this.modal.style.left = `${e.clientX}px`;
    this.modal.style.top = `${e.clientY}px`;
  }

  startDrag(e) {
    this.isDragging = true;
    const rect = this.modal.getBoundingClientRect();
    this.dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    this.modal.style.cursor = 'grabbing';
  }

  dragModal(e) {
    if (!this.isDragging) return;
    this.modal.style.left = `${e.clientX - this.dragOffset.x}px`;
    this.modal.style.top = `${e.clientY - this.dragOffset.y}px`;
  }

  stopDrag() {
    this.isDragging = false;
    this.modal.style.cursor = 'grab';
  }

  setState(newState) {

    //this.updateUI();

    if (newState == 'hide') {
      this.modal.style.display = 'none';
    }
    else {

      this.state = newState;

      if (this.state == 'close') {
        ws.send(JSON.stringify({ w: [[`${this.id}_OPEN`, 0], [`${this.id}_CLOSE`, 1]] }));
      }
      if (this.state == 'open') {
        ws.send(JSON.stringify({ w: [[`${this.id}_OPEN`, 1], [`${this.id}_CLOSE`, 0]] }));
      }
      if (this.state == 'stop') {
        ws.send(JSON.stringify({ w: [[`${this.id}_OPEN`, 0], [`${this.id}_CLOSE`, 0]] }));
      }
    }
  }

  updateUI() {
    // Меняем цвет кнопки (_vlv01)
    //this.btn.setAttribute('fill', this.state === 'open' ? '#4CAF50' : '#f44336');


  }
}

// Запуск системы
new ValveSystem();