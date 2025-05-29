document.querySelectorAll('g[id^="Z"]').forEach(group => {
  // Делаем всю группу кликабельной
  group.style.pointerEvents = 'bounding-box';
  group.style.cursor = 'pointer';
  
  // Добавляем обработчик
  group.addEventListener('click', (e) => {
    e.stopPropagation();
    const valveId = group.id.replace('_group', '');
    handleValveClick(valveId);
  });
});